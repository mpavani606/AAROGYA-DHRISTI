import { Router } from "express";
import rateLimit from "express-rate-limit";
import { managerDashboard, managerDoctorRoster, managerHospitalProfile, updateManagerHospitalProfile, addDoctorAvailability, removeDoctorAvailability, managerMedicineInventory, upsertManagerMedicineInventory, managerNotifications, markManagerNotificationRead } from "../controllers/hospitalManagerController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requireRole } from "../middleware/rbac.js";
import { validateMongoIdParams } from "../middleware/validate.js";

export const hospitalManagerRoutes = Router();
const writeLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

hospitalManagerRoutes.use(auth, auditAccess, requireRole("hospital_manager"), validateMongoIdParams);
hospitalManagerRoutes.get("/dashboard", managerDashboard);
hospitalManagerRoutes.get("/hospital", managerHospitalProfile);
hospitalManagerRoutes.patch("/hospital", writeLimit, updateManagerHospitalProfile);
hospitalManagerRoutes.get("/doctors", managerDoctorRoster);
hospitalManagerRoutes.post("/doctors/:doctorId/availability", writeLimit, addDoctorAvailability);
hospitalManagerRoutes.delete("/doctors/:doctorId/availability/:slotId", writeLimit, removeDoctorAvailability);
hospitalManagerRoutes.get("/medicine-inventory", managerMedicineInventory);
hospitalManagerRoutes.put("/medicine-inventory", writeLimit, upsertManagerMedicineInventory);
hospitalManagerRoutes.get("/notifications", managerNotifications);
hospitalManagerRoutes.patch("/notifications/:notificationId/read", writeLimit, markManagerNotificationRead);
