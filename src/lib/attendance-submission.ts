import { z } from "zod";

export const attendancePunchSchema = z.object({
  action: z.enum(["check_in", "check_out"]),
  qrCode: z.string().max(400).optional(),
  gps: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().positive().max(10000) }).nullable().optional(),
  shiftId: z.number().int().positive().optional(),
});
