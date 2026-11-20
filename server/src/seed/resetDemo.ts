import mongoose from "mongoose";
import { env } from "../config/env.js";
import { resetDemoPatients, seedDemoPatients } from "./demoSeed.js";
import { logger } from "../services/logger.js";

try {
  await mongoose.connect(env.MONGODB_URI);
  const removedPatients = await resetDemoPatients();
  const seeded = await seedDemoPatients();
  logger.info({ removedPatients, seededPatients: seeded.patientCount }, "Synthetic demo data reset completed.");
} catch (error) {
  logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Synthetic demo reset failed.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
