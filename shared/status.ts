import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Timeline row the plugin shows in an agent's conversation while a resume is pending. */
export const STATUS_KIND = "usage-resume-status";
export const STATUS_VERSION = 1;

export const statusSchema = z.object({
  /** "disabled": a limit was reached but auto-resume is off for this agent. */
  state: z.enum(["checking", "waiting", "resumed", "cancelled", "gave_up", "disabled"]),
  /** Epoch ms of the planned resume, when known. */
  resumeAt: z.number().nullable(),
  /** Labels of the depleted quota windows, such as "Session" or "Weekly". */
  windows: z.array(z.string()),
  attempt: z.number().nullable(),
  maxAttempts: z.number(),
  /** Plain-language reason, for "cancelled". */
  reason: z.string().nullable(),
});

export type StatusData = z.infer<typeof statusSchema>;

/** Timeline row confirming that auto-resume was turned on or off for an agent. */
export const SETTING_KIND = "usage-resume-setting";
export const SETTING_VERSION = 1;

export const settingSchema = z.object({
  enabled: z.boolean(),
  /** True when turning it off also cancelled a pending resume. */
  cancelledPending: z.boolean(),
});

export type SettingData = z.infer<typeof settingSchema>;

/** Turns auto-resume on or off for one agent. Omit `enabled` to toggle. */
export const setAutoResume = defineRpc({
  name: "autoResume.set",
  input: z.object({ agentId: z.string(), enabled: z.boolean().optional() }),
  output: z.object({ enabled: z.boolean(), cancelledPending: z.boolean() }),
});
