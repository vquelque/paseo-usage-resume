import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { StatusData } from "../shared/status";

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
    case "gave_up":
      return {
        title: "Usage limit reached again",
        detail: `The agent was already resumed ${data.maxAttempts} times in a row, so it will not be resumed again. Send it a message to continue.`,
      };
  }
}

export function StatusRow({ theme, layout, item }: PluginTimelineItemProps<StatusData>) {
  const data = item.data;
  const tone =
    data.state === "resumed"
      ? theme.colors.statusSuccess
      : data.state === "gave_up"
        ? theme.colors.statusDanger
        : data.state === "cancelled"
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
      </View>
    </View>
  );
}
