import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SettingRow, StatusRow } from "./client/status-row";
import {
  SETTING_KIND,
  SETTING_VERSION,
  STATUS_KIND,
  STATUS_VERSION,
  setAutoResume,
  settingSchema,
  statusSchema,
} from "./shared/status";

function parseSwitch(args: string): boolean | undefined {
  const value = args.trim().toLowerCase();
  if (value === "") return undefined;
  if (["on", "enable", "true", "yes"].includes(value)) return true;
  if (["off", "disable", "false", "no"].includes(value)) return false;
  throw new Error(`Unknown argument "${args.trim()}". Use /autoresume on, off, or no argument to toggle.`);
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addTimelineRenderer({
      kind: STATUS_KIND,
      version: STATUS_VERSION,
      schema: statusSchema,
      Component: StatusRow,
    }),
    client.addTimelineRenderer({
      kind: SETTING_KIND,
      version: SETTING_VERSION,
      schema: settingSchema,
      Component: SettingRow,
    }),
    client.addSlashCommand({
      name: "autoresume",
      description: "Turn automatic resume after usage limits on or off for this agent",
      argumentHint: "[on|off]",
      context: "agent",
      async onSubmit({ args, agent, rpc }) {
        await rpc(setAutoResume, { agentId: agent.id, enabled: parseSwitch(args) });
      },
    }),
    client.addCommandCenterItem({
      id: "auto-resume-off",
      title: "Turn off auto-resume for this agent",
      icon: "TimerOff",
      keywords: ["usage", "limit", "resume", "disable"],
      context: "agent",
      async onSelect({ agent, rpc }) {
        await rpc(setAutoResume, { agentId: agent.id, enabled: false });
      },
    }),
    client.addCommandCenterItem({
      id: "auto-resume-on",
      title: "Turn on auto-resume for this agent",
      icon: "Timer",
      keywords: ["usage", "limit", "resume", "enable"],
      context: "agent",
      async onSelect({ agent, rpc }) {
        await rpc(setAutoResume, { agentId: agent.id, enabled: true });
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
