import { app } from "./app.js";
import { env } from "./config/env.js";
import mongoose from "mongoose";
import { startSlaJob } from "./jobs/slaJob.js";
import { startAppointmentReminderJob } from "./jobs/appointmentReminderJob.js";
import { logger } from "./services/logger.js";

mongoose.connect(env.MONGODB_URI).then(() => {
  startSlaJob();
  startAppointmentReminderJob();
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));
}).catch(() => { logger.fatal("MongoDB connection failed"); process.exit(1); });
