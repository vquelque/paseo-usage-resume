import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  execCommand,
  type PluginHookAgent,
  type PluginHookContext,
  type PluginServerContext,
  type PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import { findDepletion, looksLikeLimit, type UsageEntry } from "./server/limit";
import { STATUS_KIND, STATUS_VERSION, type StatusData } from "./shared/status";

/** Sent to the agent once its quota is back. */
const RESUME_PROMPT =
  "Your provider usage limit has reset. Continue the task from where you stopped.";
/** Resumes per agent before giving up, until a turn of that agent completes normally. */
const MAX_ATTEMPTS = 4;
/** Wait this long past the announced reset before prompting. */
const RESET_MARGIN_MS = 90_000;
/** Delay between checks when the reset time is unknown or usage cannot be read. */
const RECHECK_MS = 10 * 60_000;
/** Delay before the single blind retry of a failed turn whose quota does not look depleted. */
const BLIND_RETRY_MS = 5 * 60_000;
/** A pending resume is abandoned when it could not be settled within this time. */
const MAX_PENDING_MS = 8 * 24 * 60 * 60_000;
const TICK_MS = 30_000;
const CLI_TIMEOUT_MS = 60_000;

interface Pending {
  agentId: string;
  provider: string;
  /** "failed" turns are retried even without a confirmed depletion; "completed" ones are not. */
  outcome: "failed" | "completed";
  detectedAt: number;
  dueAt: number;
  /** True once a depleted window was seen, so the next clear reading means "quota is back". */
  sawDepletion: boolean;
  blindRetryScheduled: boolean;
  /** Timeline row that shows this resume in the agent's conversation. */
  rowId?: string;
  windows?: string[];
}

interface State {
  pending: Record<string, Pending>;
  attempts: Record<string, number>;
}

const stateFile = join(
  process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
  "usage-resume",
  "state.json",
);

function log(message: string): void {
  console.log(`[usage-resume] ${message}`);
}

function short(agentId: string): string {
  return agentId.slice(0, 8);
}

async function loadState(): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as Partial<State>;
    return { pending: parsed.pending ?? {}, attempts: parsed.attempts ?? {} };
  } catch {
    return { pending: {}, attempts: {} };
  }
}

async function paseoJson(args: string[]): Promise<unknown> {
  const { stdout } = await execCommand("paseo", [...args, "--json"], {
    env: process.env,
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

interface AgentInfo {
  status: string | null;
  archived: boolean;
  model: string | null;
}

async function inspectAgent(agentId: string): Promise<AgentInfo | null> {
  try {
    const info = (await paseoJson(["inspect", agentId])) as Record<string, unknown>;
    return {
      status: typeof info.Status === "string" ? info.Status : null,
      archived: info.Archived === true,
      model: typeof info.Model === "string" ? info.Model : null,
    };
  } catch {
    return null;
  }
}

/** Text of the last assistant/error/notification rows of the turn that just ended. */
async function turnTail(
  agent: PluginHookAgent,
  turnId: string | null,
  context: PluginHookContext,
): Promise<string[]> {
  try {
    const page = (await context.paseo.agents
      .ref(agent.id)
      .timeline.refetch({ direction: "tail", limit: 6 })) as unknown as {
      entries?: { turnId?: string | null; item?: Record<string, unknown> }[];
    };
    const texts: string[] = [];
    for (const entry of (page.entries ?? []).slice(-3)) {
      if (turnId && entry.turnId && entry.turnId !== turnId) continue;
      const item = entry.item;
      if (!item) continue;
      if (item.type === "assistant_message" && typeof item.text === "string") texts.push(item.text);
      if ((item.type === "error" || item.type === "notification") && typeof item.message === "string")
        texts.push(item.message);
    }
    return texts;
  } catch (error) {
    log(`could not read the timeline of ${short(agent.id)}: ${String(error)}`);
    return [];
  }
}

export default function contribute(server: PluginServerContext) {
  let state: State = { pending: {}, attempts: {} };
  let saving: Promise<void> = Promise.resolve();
  let stopped = false;
  const busy = new Set<string>();
  /** Daemon session, taken from the first hook that fires; it lives as long as this process. */
  let api: PluginHookContext["paseo"] | null = null;

  function rowIdOf(pending: Pending): string {
    return pending.rowId ?? `usage-resume-${pending.detectedAt}`;
  }

  /** Shows or updates the status row in the agent's conversation. Never blocks the resume. */
  function show(agentId: string, rowId: string, status: Partial<StatusData> & Pick<StatusData, "state">): void {
    if (!api) return;
    const data: StatusData = {
      resumeAt: null,
      windows: [],
      attempt: null,
      maxAttempts: MAX_ATTEMPTS,
      reason: null,
      ...status,
    };
    api.agents
      .ref(agentId)
      .timeline.append({ type: "plugin", id: rowId, kind: STATUS_KIND, version: STATUS_VERSION, data })
      .catch((error) => log(`${short(agentId)}: could not show the status row: ${String(error)}`));
  }

  function save(): Promise<void> {
    const snapshot = JSON.stringify(state, null, 2);
    saving = saving
      .then(async () => {
        await mkdir(dirname(stateFile), { recursive: true });
        await writeFile(`${stateFile}.tmp`, snapshot);
        await rename(`${stateFile}.tmp`, stateFile);
      })
      .catch((error) => log(`could not save state: ${String(error)}`));
    return saving;
  }

  function drop(agentId: string, reason: string): void {
    const pending = state.pending[agentId];
    if (!pending) return;
    show(agentId, rowIdOf(pending), { state: "cancelled", windows: pending.windows ?? [], reason });
    delete state.pending[agentId];
    log(`${short(agentId)}: resume dropped (${reason})`);
    void save();
  }

  async function resume(pending: Pending): Promise<void> {
    const info = await inspectAgent(pending.agentId);
    if (!info) return drop(pending.agentId, "agent no longer exists");
    if (info.archived) return drop(pending.agentId, "agent is archived");
    if (info.status === "running" || info.status === "initializing")
      return drop(pending.agentId, "the agent is already working again");

    delete state.pending[pending.agentId];
    state.attempts[pending.agentId] = (state.attempts[pending.agentId] ?? 0) + 1;
    await save();
    await execCommand("paseo", ["send", pending.agentId, "--no-wait", "--prompt", RESUME_PROMPT], {
      env: process.env,
      timeout: CLI_TIMEOUT_MS,
    });
    show(pending.agentId, rowIdOf(pending), {
      state: "resumed",
      windows: pending.windows ?? [],
      attempt: state.attempts[pending.agentId],
    });
    log(
      `${short(pending.agentId)}: resumed (attempt ${state.attempts[pending.agentId]} of ${MAX_ATTEMPTS})`,
    );
  }

  /** Reads the agent's quota and either reschedules the resume or sends it. */
  async function settle(pending: Pending): Promise<void> {
    const now = Date.now();
    if (now - pending.detectedAt > MAX_PENDING_MS) return drop(pending.agentId, "the quota did not come back within 8 days");

    const info = await inspectAgent(pending.agentId);
    if (!info) return drop(pending.agentId, "agent no longer exists");
    if (info.archived) return drop(pending.agentId, "agent is archived");

    let entries: UsageEntry[];
    try {
      entries = (await paseoJson([
        "usage",
        "ls",
        "--agent",
        pending.agentId,
        "--refresh",
      ])) as UsageEntry[];
    } catch (error) {
      pending.dueAt = now + RECHECK_MS;
      log(`${short(pending.agentId)}: usage unreadable, checking again in 10 min (${String(error)})`);
      return void save();
    }

    const readable = entries.some((entry) => entry.report?.status === "available");
    const depletion = findDepletion(entries, info.model);

    if (depletion) {
      pending.sawDepletion = true;
      const target = depletion.resetsAt === null ? 0 : depletion.resetsAt + RESET_MARGIN_MS;
      // A reset time in the past means the report has not rolled over yet.
      pending.dueAt = target > now ? target : now + RECHECK_MS;
      pending.windows = depletion.labels;
      show(pending.agentId, rowIdOf(pending), {
        state: "waiting",
        windows: depletion.labels,
        resumeAt: target > now ? target : null,
      });
      log(
        `${short(pending.agentId)}: ${depletion.labels.join(", ")} depleted, next check ${new Date(pending.dueAt).toISOString()}`,
      );
      return void save();
    }

    if (!readable) {
      pending.dueAt = now + RECHECK_MS;
      log(`${short(pending.agentId)}: no usage report available, checking again in 10 min`);
      return void save();
    }

    if (pending.sawDepletion) return resume(pending);

    // The quota does not look depleted. A failed turn still gets one delayed retry,
    // which covers short provider rate limits; a completed turn was a false alarm.
    if (pending.outcome === "completed") return drop(pending.agentId, "the quota is not depleted");
    if (!pending.blindRetryScheduled) {
      pending.blindRetryScheduled = true;
      pending.dueAt = now + BLIND_RETRY_MS;
      show(pending.agentId, rowIdOf(pending), { state: "waiting", resumeAt: pending.dueAt });
      log(`${short(pending.agentId)}: quota not depleted, retrying once in 5 min`);
      return void save();
    }
    return resume(pending);
  }

  async function run(agentId: string): Promise<void> {
    const pending = state.pending[agentId];
    if (!pending || busy.has(agentId) || stopped) return;
    busy.add(agentId);
    try {
      await settle(pending);
    } catch (error) {
      log(`${short(agentId)}: ${String(error)}`);
      if (state.pending[agentId]) {
        state.pending[agentId].dueAt = Date.now() + RECHECK_MS;
        void save();
      }
    } finally {
      busy.delete(agentId);
    }
  }

  async function onTurnEnd(
    agent: PluginHookAgent,
    turnId: string | null,
    outcome: PluginTurnOutcome,
    context: PluginHookContext,
  ): Promise<void> {
    if (outcome.kind === "canceled") return drop(agent.id, "the turn was cancelled");
    // Child agents are left to their parent, which re-drives them once it is resumed.
    if (agent.parentAgentId) {
      const errorText =
        outcome.kind === "failed" ? `${outcome.error.code ?? ""} ${outcome.error.message}` : "";
      if (looksLikeLimit(errorText))
        log(`${short(agent.id)}: child agent hit a usage limit, left to parent ${short(agent.parentAgentId)}`);
      return;
    }

    const errorText =
      outcome.kind === "failed" ? `${outcome.error.code ?? ""} ${outcome.error.message}` : "";
    const limited =
      looksLikeLimit(errorText) || (await turnTail(agent, turnId, context)).some(looksLikeLimit);

    if (!limited) {
      if (outcome.kind === "completed" && (state.attempts[agent.id] || state.pending[agent.id])) {
        delete state.attempts[agent.id];
        delete state.pending[agent.id];
        void save();
      }
      return;
    }

    if ((state.attempts[agent.id] ?? 0) >= MAX_ATTEMPTS) {
      log(`${short(agent.id)}: usage limit again after ${MAX_ATTEMPTS} resumes, giving up`);
      show(agent.id, `usage-resume-${Date.now()}`, { state: "gave_up" });
      return;
    }

    const now = Date.now();
    state.pending[agent.id] = {
      agentId: agent.id,
      provider: agent.provider,
      outcome: outcome.kind,
      detectedAt: now,
      dueAt: now,
      sawDepletion: false,
      blindRetryScheduled: false,
      rowId: `usage-resume-${now}`,
    };
    show(agent.id, `usage-resume-${now}`, { state: "checking" });
    log(`${short(agent.id)}: turn stopped by a usage limit (${agent.provider})`);
    await save();
    await run(agent.id);
  }

  const removers = [
    server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, context) => {
      api = context.paseo;
      await onTurnEnd(agent, turnId, outcome, context);
    }),
    // Someone prompted the agent while a resume was pending: their prompt takes over.
    server.addHook("agent.turn.before", async ({ agent }, context) => {
      api = context.paseo;
      drop(agent.id, "the agent received a new message");
    }),
    server.addHook("agent.archive.after", async ({ agent }, context) => {
      api = context.paseo;
      drop(agent.id, "agent archived");
      if (state.attempts[agent.id]) {
        delete state.attempts[agent.id];
        void save();
      }
    }),
  ];

  const ready = loadState().then((loaded) => {
    // Hooks may have fired while the file was loading; their entries win.
    state = {
      pending: { ...loaded.pending, ...state.pending },
      attempts: { ...loaded.attempts, ...state.attempts },
    };
    const count = Object.keys(state.pending).length;
    log(`started, ${count} pending resume${count === 1 ? "" : "s"}`);
    return undefined;
  });

  const timer = setInterval(() => {
    void ready.then(() => {
      const now = Date.now();
      for (const pending of Object.values(state.pending)) {
        if (pending.dueAt <= now) void run(pending.agentId);
      }
      return undefined;
    });
  }, TICK_MS);

  return async () => {
    stopped = true;
    clearInterval(timer);
    for (const remove of removers) remove();
    await saving;
  };
}
