import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { seedAsrFacilityDirectory } from "./asrDirectorySeed.js";

await mongoose.connect(env.MONGODB_URI);
try {
  const summary = await seedAsrFacilityDirectory();
  logger.info(summary, "ASR facility and medical officer directory imported.");
} finally {
  await mongoose.disconnect();
}
