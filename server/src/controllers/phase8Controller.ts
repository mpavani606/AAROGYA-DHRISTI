import type { RequestHandler } from "express";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { Appointment } from "../models/Appointment.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Hospital } from "../models/Geo.js";
import { VideoSession } from "../models/VideoSession.js";
import { Notification } from "../models/Notification.js";
import { Consent } from "../models/Consent.js";
import { LocationShare } from "../models/LocationShare.js";
import { Patient } from "../models/Patient.js";
import { Case } from "../models/Case.js";
import { NavigatorTask } from "../models/NavigatorTask.js";
import { ContactAttempt } from "../models/ContactAttempt.js";
import { TransportRequest } from "../models/TransportRequest.js";
import { AuditLog } from "../models/AuditLog.js";
import { queueAppointmentNotifications } from "../services/notificationService.js";
import { signLocationToken, verifyLocationToken } from "../services/locationTokenService.js";
import { createDailyMeetingToken, createDailyRoom, isVideoSessionActive } from "../services/videoService.js";
import { patientIsAssigned } from "../middleware/patientCareRelationship.js";
import { phoneHashVariants } from "../services/patientService.js";
import { bookAppointment, matchesAvailability, releaseAvailability, reserveAvailability } from "../services/appointmentBookingService.js";

const error = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) => res.status(status).json({ error: { code, message_en, message_te: "చెల్లని అభ్యర్థన.", message_hi: "अमान्य अनुरोध।" } });
const id = z.string().min(1);
const appointmentStatuses = ["requested", "confirmed", "rescheduled", "attended", "missed", "cancelled", "assessment_completed"] as const;
const consultationDurationMs = 30 * 60_000;
type AvailabilityWindow = {
  _id: { toString(): string };
  start?: Date;
  end?: Date;
  booked?: boolean;
  bookings?: Array<{ start: Date; end: Date }>;
};
export const listAppointments: RequestHandler = async (req, res, next) => {
  try {
    const patientIds = req.user!.role === "patient" && req.user!.phone
      ? await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user!.phone) }, active: true }).distinct("_id")
      : [];
    const appointments = await Appointment.find({ $or: [{ patient: { $in: patientIds.length ? patientIds : [req.user!.id] } }, { clinician: req.user!.id }] })
      .sort({ startAt: 1 }).populate("hospital", "name address");
    res.json({ appointments });
  } catch (e) { next(e); }
};

export const availableDoctors: RequestHandler = async (_req, res, next) => {
  try {
    const [activeHospitalIds, activeHospitals] = await Promise.all([
      Hospital.find({ active: true }).distinct("_id"),
      Hospital.find({ active: true }).select("_id name synthetic").sort({ name: 1 }).lean()
    ]);
    const profiles = await DoctorProfile.find({
      hospital: { $in: activeHospitalIds },
      $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
    }).select("user hospital specialty synthetic").populate({ path: "user", match: { role: "doctor", status: "active" }, select: "_id name" }).populate("hospital", "name synthetic").lean();
    const doctors = profiles.flatMap((profile) => {
      const user = profile.user as { _id: { toString(): string }; name: string } | null;
      const hospital = profile.hospital as { _id: { toString(): string }; name: string; synthetic?: boolean } | null;
      if (!user || !hospital) return [];
      return [{ _id: user._id.toString(), name: user.name, hospitalId: hospital._id.toString(), hospitalName: hospital.name, specialty: profile.specialty, synthetic: Boolean(profile.synthetic || hospital.synthetic) }];
    });
    const hospitalIdsWithDoctors = new Set(doctors.map((doctor) => doctor.hospitalId));
    res.json({ hospitals: activeHospitals.filter((hospital) => hospitalIdsWithDoctors.has(String(hospital._id))), doctors });
  } catch (e) { next(e); }
};

export const doctorSlots: RequestHandler = async (req, res, next) => {
  try {
    const profile = await DoctorProfile.findOne({
      user: id.parse(String(req.params.id)),
      $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
    });
    if (!profile || !profile.hospital || !await Hospital.exists({ _id: profile.hospital, active: true })) return error(res, "NOT_FOUND", "Verified doctor profile not found.", 404);
    const appointments = await Appointment.find({
      clinician: profile.user,
      status: { $in: ["requested", "confirmed", "rescheduled"] },
      endAt: { $gt: new Date() }
    }).select("startAt endAt").lean();
    const now = Date.now();
    const slots = (profile.availability as Array<{
      _id: { toString(): string };
      booked?: boolean;
      start?: Date;
      end?: Date;
      bookings?: Array<{ start: Date; end: Date }>;
    }>).flatMap((schedule) => {
      if (schedule.booked || !schedule.start || !schedule.end) return [];
      const availableSlots: Array<{ id: string; availabilityId: string; start: Date; end: Date }> = [];
      for (let start = schedule.start.getTime(); start + consultationDurationMs <= schedule.end.getTime(); start += consultationDurationMs) {
        const end = start + consultationDurationMs;
        const overlapsBooking = schedule.bookings?.some((booking) => booking.start.getTime() < end && booking.end.getTime() > start);
        const overlapsAppointment = appointments.some((appointment) => appointment.startAt.getTime() < end && appointment.endAt.getTime() > start);
        if (start > now && !overlapsBooking && !overlapsAppointment) {
          availableSlots.push({
            id: `${schedule._id.toString()}-${start}`,
            availabilityId: schedule._id.toString(),
            start: new Date(start),
            end: new Date(end)
          });
        }
      }
      return availableSlots;
    });
    res.json({ slots });
  } catch (e) { next(e); }
};

export const createOwnAppointment: RequestHandler = async (req, res, next) => {
  try {
    if (req.user?.role !== "patient" || !req.user.phone) return error(res, "FORBIDDEN", "Patient account access is required.", 403);
    const patients = await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user.phone) }, active: true }).limit(2);
    if (patients.length !== 1) return error(res, patients.length ? "PATIENT_LINK_AMBIGUOUS" : "NOT_FOUND", "Unable to resolve the patient record linked to this account.", patients.length ? 409 : 404);
    req.body = { ...req.body, patientId: patients[0]._id.toString() };
    await createAppointment(req, res, next);
  } catch (e) { next(e); }
};

export const createAppointment: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ caseId: z.string().regex(/^[a-f\d]{24}$/i).optional(), patientId: z.string(), type: z.enum(["video", "physical"]), clinicianId: z.string().regex(/^[a-f\d]{24}$/i), hospitalId: z.string().optional(), availabilityId: z.string().regex(/^[a-f\d]{24}$/i), startAt: z.coerce.date(), endAt: z.coerce.date(), clientUuid: z.string().uuid().optional() }).parse(req.body);
    let patientId = body.patientId;
    if (req.user?.role === "patient") {
      if (!req.user.phone) return error(res, "FORBIDDEN", "Patient account access is required.", 403);
      const linkedPatients = await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user.phone) }, active: true }).limit(2);
      if (linkedPatients.length !== 1) return error(res, linkedPatients.length ? "PATIENT_LINK_AMBIGUOUS" : "NOT_FOUND", "Unable to resolve the patient record linked to this account.", linkedPatients.length ? 409 : 404);
      patientId = linkedPatients[0]._id.toString();
      if (body.patientId !== patientId) return error(res, "FORBIDDEN", "Patients can book only for their own linked record.", 403);
    }
    const booking = await bookAppointment({ ...body, patientId });
    res.status(booking.replayed ? 200 : 201).json({ appointment: booking.appointment });
  } catch (e) { next(e); }
};

export const updateAppointment: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      startAt: z.coerce.date().optional(),
      endAt: z.coerce.date().optional(),
      availabilityId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
      status: z.enum(appointmentStatuses).optional(),
      missedReason: z.string().max(1000).optional()
    }).parse(req.body);
    const appointment = await Appointment.findById(String(req.params.id));
    if (!appointment) return error(res, "NOT_FOUND", "Appointment not found.", 404);
    if (appointment.status === "cancelled" && body.status && body.status !== "cancelled") {
      return error(res, "APPOINTMENT_CANCELLED", "A cancelled appointment cannot be reactivated.", 409);
    }
    const startAt = body.startAt ?? appointment.startAt;
    const endAt = body.endAt ?? appointment.endAt;
    const previousAvailabilityId = appointment.availabilityId?.toString();
    const availabilityId = body.availabilityId ?? previousAvailabilityId;
    const timeChanged = startAt.getTime() !== appointment.startAt.getTime() || endAt.getTime() !== appointment.endAt.getTime();
    const availabilityChanged = Boolean(timeChanged || (body.availabilityId && body.availabilityId !== previousAvailabilityId));
    if (appointment.status === "cancelled" && availabilityChanged) {
      return error(res, "APPOINTMENT_CANCELLED", "A cancelled appointment cannot be rescheduled.", 409);
    }
    if (timeChanged && !body.availabilityId) return error(res, "SCHEDULE_REQUIRED", "Choose a new availability slot when rescheduling.", 400);
    if (timeChanged && (startAt <= new Date() || endAt <= startAt)) return error(res, "INVALID_TIME", "Choose a future consultation time.");

    let reservedNewTime = false;
    if (availabilityChanged) {
      if (!availabilityId || body.status === "cancelled") return error(res, "SCHEDULE_REQUIRED", "Choose an available consultation time when rescheduling.", 400);
      const profile = await DoctorProfile.findOne({ user: appointment.clinician }).select("availability");
      const schedule = (profile?.availability as AvailabilityWindow[] | undefined)
        ?.find((slot) => matchesAvailability(slot, availabilityId, startAt, endAt));
      if (!schedule) return error(res, "SLOT_UNAVAILABLE", "Choose an available consultation time from the doctor's schedule.", 409);
      const conflict = await Appointment.exists({
        _id: { $ne: appointment._id },
        clinician: appointment.clinician,
        status: { $in: ["requested", "confirmed", "rescheduled"] },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt }
      });
      if (conflict) return error(res, "SLOT_UNAVAILABLE", "That appointment slot is unavailable.", 409);
      reservedNewTime = await reserveAvailability(appointment.clinician.toString(), availabilityId, startAt, endAt);
      if (!reservedNewTime) return error(res, "SLOT_UNAVAILABLE", "That consultation time was just booked. Choose another available time.", 409);
    }

    const previousStartAt = appointment.startAt;
    const previousEndAt = appointment.endAt;
    const previousStatus = appointment.status;
    const changes: Record<string, unknown> = { startAt, endAt };
    if (availabilityChanged) changes.availabilityId = availabilityId;
    if (body.status) changes.status = body.status;
    if (body.missedReason !== undefined) changes.missedReason = body.missedReason;
    let updatedAppointment;
    try {
      updatedAppointment = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          startAt: previousStartAt,
          endAt: previousEndAt,
          status: previousStatus,
          availabilityId: previousAvailabilityId ?? null
        },
        { $set: changes },
        { new: true, runValidators: true }
      );
    } catch (saveError) {
      if (reservedNewTime && availabilityId) await releaseAvailability(appointment.clinician.toString(), availabilityId, startAt, endAt);
      throw saveError;
    }
    if (!updatedAppointment) {
      if (reservedNewTime && availabilityId) await releaseAvailability(appointment.clinician.toString(), availabilityId, startAt, endAt);
      return error(res, "APPOINTMENT_UPDATED", "This appointment changed while you were updating it. Reload and try again.", 409);
    }

    if (availabilityChanged && previousAvailabilityId) {
      await releaseAvailability(appointment.clinician.toString(), previousAvailabilityId, previousStartAt, previousEndAt);
    }
    if (body.status === "cancelled" && availabilityId) {
      await releaseAvailability(appointment.clinician.toString(), availabilityId, startAt, endAt);
    }
    res.json({ appointment: updatedAppointment });
  } catch (e) { next(e); }
};

export const confirmAppointment: RequestHandler = async (req, res, next) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(String(req.params.id), { $set: { status: "confirmed" } }, { new: true });
    if (!appointment) return error(res, "NOT_FOUND", "Appointment not found.", 404);
    await queueAppointmentNotifications({ patient: appointment.patient.toString(), clinician: appointment.clinician.toString(), tokenNo: appointment.tokenNo, startAt: appointment.startAt });
    res.json({ appointment, notificationsQueued: true });
  } catch (e) { next(e); }
};

export const attendance: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["attended", "missed", "assessment_completed"]), missedReason: z.string().max(1000).optional() }).parse(req.body);
    const appointment = await Appointment.findByIdAndUpdate(String(req.params.id), { $set: body }, { new: true });
    if (!appointment) return error(res, "NOT_FOUND", "Appointment not found.", 404);
    if (body.status === "missed" && appointment.case) await NavigatorTask.create({ case: appointment.case, patient: appointment.patient, type: "missed_visit", dueAt: new Date(), riskPoints: 3, details: { appointmentId: appointment._id } });
    res.json({ appointment });
  } catch (e) { next(e); }
};

export const createVideoRoom: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ appointmentId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.body);
    const appointment = await Appointment.findById(body.appointmentId);
    if (!appointment || appointment.type !== "video") return error(res, "NOT_FOUND", "Video appointment not found.", 404);
    const patient = await Patient.findById(appointment.patient).select("createdBy phoneHash");
    const isPatientParticipant = req.user!.role === "patient" && Boolean(patient && patientIsAssigned(patient, req.user!));
    if (appointment.clinician.toString() !== req.user!.id && !isPatientParticipant) {
      return error(res, "FORBIDDEN", "Only the appointment's patient or doctor may access this video room.", 403);
    }
    if (appointment.status !== "confirmed") return error(res, "APPOINTMENT_NOT_CONFIRMED", "The video consultation is available after the appointment is confirmed.", 409);
    if (!await Consent.exists({
      patient: appointment.patient,
      purpose: { $in: ["teleconsultation", "telemedicine"] },
      granted: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    })) return error(res, "TELEMEDICINE_CONSENT_REQUIRED", "Telemedicine consent is required for this consultation.", 403);
    if (!isVideoSessionActive(appointment.endAt)) return error(res, "VIDEO_EXPIRED", "This appointment has already ended.", 410);
    const existing = await VideoSession.findOne({ appointment: appointment._id });
    if (existing?.provider === "daily" && existing.roomUrl && isVideoSessionActive(existing.expiresAt)) {
      return res.json({ session: existing, recordingEnabled: false });
    }
    const roomName = `aarogya-${appointment._id.toString()}`;
    const room = await createDailyRoom(roomName, appointment.endAt);
    let session;
    if (existing) {
      existing.provider = "daily";
      existing.roomName = room.name;
      existing.roomUrl = room.url;
      existing.expiresAt = appointment.endAt;
      existing.recordingEnabled = false;
      existing.waitingRoom = true;
      session = await existing.save();
    } else {
      try {
        session = await VideoSession.create({
          appointment: appointment._id,
          provider: "daily",
          roomName: room.name,
          roomUrl: room.url,
          expiresAt: appointment.endAt,
          recordingEnabled: false,
          waitingRoom: true
        });
      } catch (createError) {
        if (typeof createError !== "object" || createError === null || !("code" in createError) || createError.code !== 11000) throw createError;
        const concurrentSession = await VideoSession.findOne({ appointment: appointment._id });
        if (!concurrentSession) throw createError;
        session = concurrentSession;
      }
    }
    res.status(201).json({ session, recordingEnabled: false });
  } catch (e) { next(e); }
};

export const videoToken: RequestHandler = async (req, res, next) => {
  try {
    const session = await VideoSession.findById(String(req.params.id)).populate("appointment");
    if (!session || !isVideoSessionActive(session.expiresAt)) return error(res, "VIDEO_EXPIRED", "This video room has expired.", 410);
    const appointment = session.appointment as unknown as { clinician: { toString(): string }; patient: { toString(): string }; type: string; status: string };
    if (appointment.type !== "video" || appointment.status !== "confirmed") return error(res, "APPOINTMENT_NOT_CONFIRMED", "The video consultation is no longer available.", 409);
    const patient = await Patient.findById(appointment.patient).select("createdBy phoneHash");
    const isPatientParticipant = req.user!.role === "patient" && Boolean(patient && patientIsAssigned(patient, req.user!));
    const isParticipant = appointment.clinician.toString() === req.user!.id || isPatientParticipant;
    if (!isParticipant) return error(res, "FORBIDDEN", "You are not an authorised participant.", 403);
    if (!await Consent.exists({
      patient: appointment.patient,
      purpose: { $in: ["teleconsultation", "telemedicine"] },
      granted: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
    })) return error(res, "TELEMEDICINE_CONSENT_REQUIRED", "Telemedicine consent is required for this consultation.", 403);
    if (session.provider !== "daily" || !session.roomUrl) return error(res, "VIDEO_PROVIDER_UNAVAILABLE", "The video room is not available.", 503);
    const userName = req.user!.role === "doctor" ? "Doctor" : "Patient";
    const token = await createDailyMeetingToken(session.roomName, session.expiresAt, req.user!.id, userName, req.user!.role === "doctor");
    res.json({ token, roomUrl: session.roomUrl, expiresAt: session.expiresAt, provider: session.provider, roomName: session.roomName });
  } catch (e) { next(e); }
};

export const directions: RequestHandler = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(String(req.params.id)); if (!appointment?.hospital) return error(res, "NOT_FOUND", "Hospital location is unavailable.", 404);
    const hospital = await Hospital.findById(appointment.hospital); if (!hospital?.lat || !hospital.lng) return error(res, "LOCATION_UNAVAILABLE", "Hospital coordinates are unavailable.", 422);
    const patient = await Patient.findById(appointment.patient).select("mandal");
    res.json({ hospital: { name: hospital.name, lat: hospital.lat, lng: hospital.lng }, patientVillage: patient?.mandal ?? null, distanceKm: null, deepLink: `https://www.google.com/maps/dir/?api=1&destination=${hospital.lat},${hospital.lng}` });
  } catch (e) { next(e); }
};

export const appointmentSlip: RequestHandler = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(String(req.params.id)).populate("hospital", "name address");
    if (!appointment) return error(res, "NOT_FOUND", "Appointment not found.", 404);
    const doc = new PDFDocument({ margin: 48 }); const chunks: Buffer[] = []; doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => { res.type("application/pdf").send(Buffer.concat(chunks)); });
    doc.fontSize(18).text("Aarogya Drishti"); doc.fontSize(12).text("SIMULATION - NOT FOR CLINICAL USE"); doc.moveDown().text(`Health appointment / ఆరోగ్య అపాయింట్‌మెంట్ / स्वास्थ्य अपॉइंटमेंट`); doc.text(`Token: ${appointment.tokenNo ?? "—"}`); doc.text(`When: ${appointment.startAt.toLocaleString("en-IN")}`); doc.text("Please carry this slip. QR contains an opaque appointment reference only."); doc.end();
  } catch (e) { next(e); }
};

export const requestLocation: RequestHandler = async (req, res, next) => {
  try { const patientId = id.parse(String(req.params.id || req.body.patientId)); if (!await Patient.exists({ _id: patientId })) return error(res, "NOT_FOUND", "Patient not found.", 404); const token = signLocationToken(patientId); console.info("[mock-sms] Consent-based location link queued."); res.json({ sent: true, demoToken: token }); } catch (e) { next(e); }
};

export const shareLocation: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ patientId: id, token: id, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), expiresAt: z.coerce.date() }).parse(req.body);
    if (!verifyLocationToken(body.token, body.patientId)) return error(res, "INVALID_LOCATION_TOKEN", "Location link is invalid or expired.", 401);
    if (body.expiresAt <= new Date() || body.expiresAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) return error(res, "INVALID_EXPIRY", "Location sharing expiry must be within the next 24 hours.");
    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    if (await LocationShare.exists({ tokenHash })) return error(res, "LOCATION_TOKEN_USED", "This location link has already been used.", 409);
    const consent = await Consent.findOne({ patient: body.patientId, purpose: "location", granted: true, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] });
    if (!consent) return error(res, "LOCATION_CONSENT_REQUIRED", "Location consent is required.", 403);
    const share = await LocationShare.create({ patient: body.patientId, lat: body.lat, lng: body.lng, source: "patient_link", consent: consent._id, tokenHash, expiresAt: body.expiresAt });
    res.status(201).json({ share });
  } catch (e) { next(e); }
};

export const caseLocation: RequestHandler = async (req, res, next) => {
  try {
    const item = await Case.findById(String(req.params.id)).populate("patient", "mandal"); if (!item) return error(res, "NOT_FOUND", "Case not found.", 404);
    const share = await LocationShare.findOne({ patient: item.patient._id, expiresAt: { $gt: new Date() } }).sort({ sharedAt: -1 });
    if (!share) return error(res, "LOCATION_UNAVAILABLE", "No active consent-based location is available.", 404);
    await AuditLog.create({ actor: req.user!.id, action: "access", resource: "LocationShare", resourceId: share._id.toString() });
    res.json({ location: share, notice: "Location is consent-based. Live tracking from a phone number alone is not possible or lawful." });
  } catch (e) { next(e); }
};

export const navigatorTasks: RequestHandler = async (req, res, next) => { try { const tasks = await NavigatorTask.find({ status: { $in: ["open", "in_progress"] } }).sort({ dueAt: 1 }).populate("patient", "mandal createdBy mandalId phcId villageId habitationId"); const visible = req.user!.role === "system_admin" ? tasks : tasks.filter((task) => task.patient && patientIsAssigned(task.patient as unknown as Parameters<typeof patientIsAssigned>[0], req.user!)); res.json({ tasks: visible }); } catch (e) { next(e); } };
export const contactAttempt: RequestHandler = async (req, res, next) => { try { const body = z.object({ channel: z.enum(["phone", "home_visit", "sms"]), outcome: z.enum(["reached", "no_answer", "wrong_number", "promised_follow_up"]), notes: z.string().max(2000).optional() }).parse(req.body); const attempt = await ContactAttempt.create({ ...body, task: req.params.id, attemptedBy: req.user!.id }); const task = await NavigatorTask.findById(req.params.id); if (task && body.outcome === "no_answer") { task.riskPoints += 3; task.riskBand = task.riskPoints >= 5 ? "High" : task.riskPoints >= 3 ? "Medium" : "Low"; await task.save(); } res.status(201).json({ attempt }); } catch (e) { next(e); } };
export const transportRequest: RequestHandler = async (req, res, next) => { try { const body = z.object({ mode: z.enum(["community_vehicle", "108", "bike_ambulance"]), emergency: z.boolean().default(false), notes: z.string().max(1000).optional() }).parse(req.body); if (body.mode === "108" && !body.emergency) return error(res, "EMERGENCY_ONLY", "108 is reserved for emergencies."); const item = await TransportRequest.create({ ...body, task: req.params.id, requestedBy: req.user!.id }); res.status(201).json({ transport: item }); } catch (e) { next(e); } };
export const notifications: RequestHandler = async (req, res, next) => {
  try {
    const patientIds = req.user!.role === "patient" && req.user!.phone
      ? await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user!.phone) }, active: true }).distinct("_id")
      : [];
    if (req.user!.role === "patient" && patientIds.length !== 1) return error(res, patientIds.length ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_NOT_FOUND", patientIds.length ? "Contact your care team to resolve the patient record." : "No patient record is linked to this account.", patientIds.length ? 409 : 404);
    const notifications = await Notification.find({
      $or: [
        { user: req.user!.id },
        ...(patientIds.length ? [{ patient: patientIds[0] }] : [])
      ]
    }).sort({ createdAt: -1 }).limit(50);
    res.json({ notifications });
  } catch (e) { next(e); }
};
export const markNotificationRead: RequestHandler = async (req, res, next) => {
  try {
    const patientIds = req.user!.role === "patient" && req.user!.phone
      ? await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user!.phone) }, active: true }).distinct("_id")
      : [];
    if (req.user!.role === "patient" && patientIds.length !== 1) return error(res, patientIds.length ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_NOT_FOUND", patientIds.length ? "Contact your care team to resolve the patient record." : "No patient record is linked to this account.", patientIds.length ? 409 : 404);
    const item = await Notification.findOneAndUpdate({
      _id: req.params.id,
      $or: [{ user: req.user!.id }, ...(patientIds.length ? [{ patient: patientIds[0] }] : [])]
    }, { $set: { status: "read" } }, { new: true });
    if (!item) return error(res, "NOT_FOUND", "Notification not found.", 404);
    res.json({ notification: item });
  } catch (e) { next(e); }
};
