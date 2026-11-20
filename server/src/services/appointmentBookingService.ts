import { z } from "zod";
import { Appointment } from "../models/Appointment.js";
import { Case } from "../models/Case.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Hospital } from "../models/Geo.js";
import { Patient } from "../models/Patient.js";
import { User } from "../models/User.js";
import { Consent } from "../models/Consent.js";

const durationMs = 30 * 60_000;
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
type AvailabilityWindow = {
  _id: { toString(): string };
  start?: Date;
  end?: Date;
  booked?: boolean;
  bookings?: Array<{ start: Date; end: Date }>;
};

const bookingError = (code: string, message: string, status = 400) =>
  Object.assign(new Error(message), { code, status });

export const matchesAvailability = (slot: AvailabilityWindow, availabilityId: string, startAt: Date, endAt: Date) =>
  slot._id.toString() === availabilityId
  && !slot.booked
  && Boolean(slot.start && slot.end && slot.start <= startAt && slot.end >= endAt)
  && endAt.getTime() - startAt.getTime() === durationMs
  && Boolean(slot.start && (startAt.getTime() - slot.start.getTime()) % durationMs === 0)
  && !slot.bookings?.some((booking) => booking.start < endAt && booking.end > startAt);

export const reserveAvailability = async (clinicianId: string, availabilityId: string, startAt: Date, endAt: Date) => {
  const result = await DoctorProfile.updateOne(
    {
      user: clinicianId,
      availability: {
        $elemMatch: {
          _id: availabilityId,
          booked: false,
          bookings: { $not: { $elemMatch: { start: { $lt: endAt }, end: { $gt: startAt } } } }
        }
      }
    },
    { $addToSet: { "availability.$[schedule].bookings": { start: startAt, end: endAt } } },
    { arrayFilters: [{ "schedule._id": availabilityId, "schedule.booked": false }] }
  );
  return result.modifiedCount === 1;
};

export const releaseAvailability = async (clinicianId: string, availabilityId: string, startAt: Date, endAt: Date) =>
  DoctorProfile.updateOne(
    { user: clinicianId, "availability._id": availabilityId },
    { $pull: { "availability.$.bookings": { start: startAt, end: endAt } } }
  );

export type AppointmentBookingInput = {
  patientId: string;
  caseId?: string;
  type: "video" | "physical";
  clinicianId: string;
  hospitalId?: string;
  availabilityId: string;
  startAt: Date;
  endAt: Date;
  clientUuid?: string;
};

export async function bookAppointment(input: AppointmentBookingInput) {
  if (!objectId.safeParse(input.patientId).success || !objectId.safeParse(input.clinicianId).success
    || !objectId.safeParse(input.availabilityId).success || (input.hospitalId && !objectId.safeParse(input.hospitalId).success)) {
    throw bookingError("INVALID_REFERENCE", "Choose a valid patient, doctor, hospital, and schedule.", 400);
  }
  if (input.endAt <= input.startAt || input.startAt <= new Date()) {
    throw bookingError("INVALID_TIME", "Choose a future appointment time.", 400);
  }
  if (input.clientUuid && !z.string().uuid().safeParse(input.clientUuid).success) {
    throw bookingError("INVALID_CLIENT_UUID", "The appointment request identifier is invalid.", 400);
  }
  const saved = input.clientUuid ? await Appointment.findOne({ clientUuid: input.clientUuid }) : null;
  if (saved) {
    if (saved.patient.toString() !== input.patientId
      || saved.clinician.toString() !== input.clinicianId
      || saved.type !== input.type
      || saved.hospital?.toString() !== input.hospitalId
      || saved.availabilityId?.toString() !== input.availabilityId
      || saved.startAt.getTime() !== input.startAt.getTime()
      || saved.endAt.getTime() !== input.endAt.getTime()) {
      throw bookingError("CLIENT_UUID_CONFLICT", "This appointment request identifier is already in use.", 409);
    }
    return { appointment: saved, replayed: true };
  }
  const [patientExists, clinician, clinicianExists] = await Promise.all([
    Patient.exists({ _id: input.patientId, active: true }),
    DoctorProfile.findOne({ user: input.clinicianId, $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }] }).select("hospital availability"),
    User.exists({ _id: input.clinicianId, role: "doctor", status: "active" })
  ]);
  if (!patientExists) throw bookingError("PATIENT_NOT_FOUND", "Patient record not found.", 404);
  if (input.type === "video" && !await Consent.exists({
    patient: input.patientId,
    purpose: { $in: ["teleconsultation", "telemedicine"] },
    granted: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
  })) throw bookingError("TELEMEDICINE_CONSENT_REQUIRED", "Grant telemedicine consent before booking a video appointment.", 403);
  if (input.caseId && (!objectId.safeParse(input.caseId).success || !await Case.exists({ _id: input.caseId, patient: input.patientId }))) {
    throw bookingError("CASE_NOT_FOUND", "The screening case does not belong to this patient.", 404);
  }
  if (!clinicianExists || !clinician?.hospital) throw bookingError("DOCTOR_NOT_FOUND", "Verified doctor account not found.", 404);
  const hospitalId = clinician.hospital.toString();
  if (input.hospitalId && input.hospitalId !== hospitalId) throw bookingError("HOSPITAL_MISMATCH", "The selected hospital does not match the doctor's assignment.", 403);
  if (!await Hospital.exists({ _id: hospitalId, active: true })) throw bookingError("HOSPITAL_UNAVAILABLE", "The doctor's assigned hospital is not active.", 404);
  const availability = clinician.availability as AvailabilityWindow[];
  const schedule = availability.find((slot) => matchesAvailability(slot, input.availabilityId, input.startAt, input.endAt));
  if (!schedule) throw bookingError("SLOT_UNAVAILABLE", "That schedule is no longer available. Choose another appointment time.", 409);
  const conflict = await Appointment.exists({
    clinician: input.clinicianId,
    status: { $in: ["requested", "confirmed", "rescheduled"] },
    startAt: { $lt: input.endAt },
    endAt: { $gt: input.startAt }
  });
  if (conflict) throw bookingError("SLOT_UNAVAILABLE", "That appointment time is already reserved.", 409);
  const claimedSlot = await reserveAvailability(input.clinicianId, input.availabilityId, input.startAt, input.endAt);
  if (!claimedSlot) {
    const retried = input.clientUuid ? await Appointment.findOne({ clientUuid: input.clientUuid }) : null;
    if (retried && retried.patient.toString() === input.patientId && retried.clinician.toString() === input.clinicianId) {
      return { appointment: retried, replayed: true };
    }
    throw bookingError("SLOT_UNAVAILABLE", "That appointment time was just booked. Choose another available time.", 409);
  }
  const dayStart = new Date(input.startAt.getFullYear(), input.startAt.getMonth(), input.startAt.getDate());
  const dayEnd = new Date(input.startAt.getFullYear(), input.startAt.getMonth(), input.startAt.getDate() + 1);
  const dailyCount = await Appointment.countDocuments({ startAt: { $gte: dayStart, $lt: dayEnd } });
  try {
    const appointment = await Appointment.create({
      clientUuid: input.clientUuid,
      case: input.caseId,
      patient: input.patientId,
      type: input.type,
      clinician: input.clinicianId,
      hospital: hospitalId,
      availabilityId: schedule._id,
      startAt: input.startAt,
      endAt: input.endAt,
      tokenNo: `AD-${String(input.startAt.getDate()).padStart(2, "0")}-${String(dailyCount + 1).padStart(3, "0")}`
    });
    return { appointment, replayed: false };
  } catch (error) {
    await releaseAvailability(input.clinicianId, input.availabilityId, input.startAt, input.endAt);
    if (input.clientUuid && error && typeof error === "object" && "code" in error && error.code === 11000) {
      const retried = await Appointment.findOne({ clientUuid: input.clientUuid });
      if (retried && retried.patient.toString() === input.patientId && retried.clinician.toString() === input.clinicianId) {
        return { appointment: retried, replayed: true };
      }
    }
    throw error;
  }
}
