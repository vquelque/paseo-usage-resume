import { z } from "zod";

/** Timeline row the plugin shows in an agent's conversation while a resume is pending. */
export const STATUS_KIND = "usage-resume-status";
export const STATUS_VERSION = 1;

export const statusSchema = z.object({
  state: z.enum(["checking", "waiting", "resumed", "cancelled", "gave_up"]),
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
