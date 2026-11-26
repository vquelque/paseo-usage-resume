import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type SettingData, type StatusData, setAutoResume } from "../shared/status";

function formatWhen(epochMs: number): string {
  const when = new Date(epochMs);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (when.toDateString() === new Date().toDateString()) return time;
  const day = when.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

function describe(data: StatusData): { title: string; detail: string | null } {
  const windows = data.windows.length > 0 ? ` (${data.windows.join(", ")})` : "";
  switch (data.state) {
    case "checking":
      return {
        title: `Usage limit reached${windows}`,
        detail: "Checking when the quota resets. The agent will be resumed automatically.",
      };
    case "waiting":
      return {
        title: `Usage limit reached${windows}`,
        detail:
          data.resumeAt === null
            ? "The agent will be resumed automatically once the quota is back."
            : `The agent will be resumed automatically at ${formatWhen(data.resumeAt)}.`,
      };
    case "resumed":
      return {
        title: "Usage limit reset",
        detail:
          data.attempt === null
            ? "The agent was resumed automatically."
            : `The agent was resumed automatically (resume ${data.attempt} of ${data.maxAttempts}).`,
      };
    case "cancelled":
      return {
        title: "Automatic resume cancelled",
        detail: data.reason ? `Reason: ${data.reason}.` : null,
      };
    case "disabled":
      return {
        title: `Usage limit reached${windows}`,
        detail:
          "Auto-resume is off for this agent. Send it a message to continue, or run /autoresume on.",
      };
    case "gave_up":
      return {
        title: "Usage limit reached again",
        detail: `The agent was already resumed ${data.maxAttempts} times in a row, so it will not be resumed again. Send it a message to continue.`,
      };
  }
}

export function StatusRow({ theme, layout, item, agentId }: PluginTimelineItemProps<StatusData>) {
  const data = item.data;
  const setEnabled = useRpc(setAutoResume);
  const [action, setAction] = useState<"idle" | "pending" | "error">("idle");
  const cancellable = data.state === "checking" || data.state === "waiting";
  const tone =
    data.state === "resumed"
      ? theme.colors.statusSuccess
      : data.state === "gave_up"
        ? theme.colors.statusDanger
        : data.state === "cancelled" || data.state === "disabled"
          ? theme.colors.foregroundMuted
          : theme.colors.statusWarning;
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: layout.compact ? 10 : 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      bar: { width: 3, borderRadius: 2, backgroundColor: tone },
      body: { flex: 1, gap: 2 },
      title: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      button: {
        alignSelf: "center" as const,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const },
    }),
    [theme, layout.compact, tone],
  );
  const { title, detail } = describe(data);
  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={styles.bar} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {action === "error" ? (
          <Text style={styles.detail}>Could not turn off auto-resume. Try /autoresume off.</Text>
        ) : null}
      </View>
      {cancellable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Don't resume this agent automatically"
          disabled={action === "pending"}
          style={({ pressed }) => [styles.button, { opacity: pressed || action === "pending" ? 0.6 : 1 }]}
          onPress={() => {
            setAction("pending");
            setEnabled({ agentId, enabled: false })
              .then(() => setAction("idle"))
              .catch(() => setAction("error"));
          }}
        >
          <Text style={styles.buttonText}>{action === "pending" ? "Cancelling…" : "Don't resume"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SettingRow({ theme, layout, item }: PluginTimelineItemProps<SettingData>) {
  const { enabled, cancelledPending } = item.data;
  const styles = useMemo(
    () => ({
      row: {
        paddingVertical: 6,
        paddingHorizontal: layout.compact ? 10 : 12,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.foregroundMuted,
      },
      text: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, layout.compact],
  );
  const text = enabled
    ? "Auto-resume turned on. This agent will be resumed after a usage limit resets."
    : cancelledPending
      ? "Auto-resume turned off. The pending resume was cancelled."
      : "Auto-resume turned off. This agent will not be resumed after a usage limit.";
  return (
    <View style={styles.row} accessibilityRole="text">
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}
