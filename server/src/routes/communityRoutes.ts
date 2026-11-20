import { Router } from "express";
import rateLimit from "express-rate-limit";
import { cancelOwnEmergencyRequest, campReport, communityOptions, createCamp, createEmergencyRequest, emergencyContactDetails, emergencyFacilities, escalateEmergencyRequest, listCamps, listEmergencyRequests, listOwnHealthCamps, listOwnEmergencyRequests, recordCampAttendance, recordEmergencyContactAttempt, registerCampParticipant, registerOwnHealthCamp, updateCampStatus, updateEmergencyRequest } from "../controllers/communityController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requireDoctorVerification } from "../middleware/doctorVerification.js";
import { requireRole } from "../middleware/rbac.js";
import { validateMongoIdParams } from "../middleware/validate.js";

export const communityRoutes = Router();
const emergencyLimit = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });
const campWriteLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

communityRoutes.use(auth, requireDoctorVerification, auditAccess, validateMongoIdParams);
communityRoutes.get(
  "/camps/options",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin"),
  communityOptions
);
communityRoutes.get(
  "/camps/mine",
  requireRole("patient"),
  listOwnHealthCamps
);
communityRoutes.get(
  "/camps",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  listCamps
);
communityRoutes.post(
  "/camps/:campId/register",
  requireRole("patient"),
  campWriteLimit,
  registerOwnHealthCamp
);
communityRoutes.post(
  "/camps",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin"),
  campWriteLimit,
  createCamp
);
communityRoutes.patch(
  "/camps/:campId/status",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin"),
  campWriteLimit,
  updateCampStatus
);
communityRoutes.post(
  "/camps/:campId/participants",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  campWriteLimit,
  registerCampParticipant
);
communityRoutes.patch(
  "/camps/:campId/participants/:participantId/attendance",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  campWriteLimit,
  recordCampAttendance
);
communityRoutes.get(
  "/camps/:campId/report",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin"),
  campReport
);
communityRoutes.post(
  "/emergency/requests",
  requireRole("patient"),
  emergencyLimit,
  createEmergencyRequest
);
communityRoutes.get(
  "/emergency/requests/mine",
  requireRole("patient"),
  listOwnEmergencyRequests
);
communityRoutes.post(
  "/emergency/requests/:requestId/cancel",
  requireRole("patient"),
  emergencyLimit,
  cancelOwnEmergencyRequest
);
communityRoutes.get(
  "/emergency/requests",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  listEmergencyRequests
);
communityRoutes.get(
  "/emergency/requests/:requestId/contact-details",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  emergencyContactDetails
);
communityRoutes.post(
  "/emergency/requests/:requestId/contact-attempts",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  campWriteLimit,
  recordEmergencyContactAttempt
);
communityRoutes.post(
  "/emergency/requests/:requestId/escalate",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  campWriteLimit,
  escalateEmergencyRequest
);
communityRoutes.patch(
  "/emergency/requests/:requestId",
  requireRole("doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"),
  campWriteLimit,
  updateEmergencyRequest
);
communityRoutes.get(
  "/emergency/facilities",
  requireRole("patient"),
  emergencyFacilities
);
