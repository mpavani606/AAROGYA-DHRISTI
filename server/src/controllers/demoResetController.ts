import type { RequestHandler } from "express";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { resetDemoPatients, seedDemoPatients } from "../seed/demoSeed.js";

const resetSchema = z.object({ confirmation: z.literal("RESET SYNTHETIC DEMO") }).strict();

export const resetDemo: RequestHandler = async (req, res, next) => {
  try {
    resetSchema.parse(req.body);
    const removedPatients = await resetDemoPatients();
    const seeded = await seedDemoPatients();
    await AuditLog.create({
      actor: req.user!.id,
      action: "reset",
      resource: "synthetic-demo",
      metadata: { removedPatients, seededPatients: seeded.patientCount }
    });
    res.json({ reset: true, removedPatients, seededPatients: seeded.patientCount });
  } catch (error) {
    next(error);
  }
};
