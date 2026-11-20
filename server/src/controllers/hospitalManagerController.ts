import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Appointment } from "../models/Appointment.js";
import { AuditLog } from "../models/AuditLog.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Hospital } from "../models/Geo.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { MedicineInventory } from "../models/MedicineInventory.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
type AvailabilitySlot = { _id: mongoose.Types.ObjectId; start: Date; end: Date; booked: boolean; bookings?: Array<{ start: Date; end: Date }> };
const unavailable = (res: Parameters<RequestHandler>[1], code: string, status: number) =>
  res.status(status).json({ error: { code, message_en: status === 404 ? "Hospital not found." : "Hospital access is unavailable." } });

const managerHospital = async (userId: string) => {
  const user = await User.findOne({ _id: userId, role: "hospital_manager", status: "active" })
    .select("_id name username email hospitalId status mfaEnabled");
  if (!user?.hospitalId) return { user, hospital: null };
  const hospital = await Hospital.findOne({ _id: user.hospitalId, active: true });
  return { user, hospital };
};

const hospitalAudit = (req: Parameters<RequestHandler>[0], action: string, resource: string, resourceId: string, hospitalId: string) =>
  AuditLog.create({
    actor: req.user!.id,
    action,
    resource,
    resourceId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    metadata: { actorRole: "hospital_manager", hospitalId, outcome: "success" }
  });

export const managerDashboard: RequestHandler = async (req, res, next) => {
  try {
    const { user, hospital } = await managerHospital(req.user!.id);
    if (!user) return unavailable(res, "UNAUTHORIZED", 401);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);

    const profiles = await DoctorProfile.find({ hospital: hospital._id })
      .select("user availability")
      .populate("user", "_id status");
    const doctors = profiles.filter((profile) => profile.user && typeof profile.user === "object");
    const doctorIds = doctors.map((profile) => (profile.user as { _id: mongoose.Types.ObjectId })._id);
    const now = new Date();
    const availability = profiles.map((profile) => profile.availability as unknown as AvailabilitySlot[]);
    const [upcomingAppointments, completedAppointments] = await Promise.all([
      Appointment.countDocuments({
        hospital: hospital._id,
        clinician: { $in: doctorIds },
        status: { $in: ["requested", "confirmed", "rescheduled"] },
        startAt: { $gte: now }
      }),
      Appointment.countDocuments({
        hospital: hospital._id,
        clinician: { $in: doctorIds },
        status: { $in: ["attended", "assessment_completed"] }
      })
    ]);

    res.json({
      hospital: {
        id: hospital._id.toString(),
        name: hospital.name,
        code: hospital.code,
        type: hospital.type,
        active: hospital.active,
        address: hospital.address,
        district: hospital.district,
        mandal: hospital.mandal,
        mandalId: hospital.mandalId,
        phone: hospital.phone,
        services: hospital.services,
        workingHours: hospital.workingHours
      },
      counts: {
        doctors: doctors.length,
        activeDoctors: doctors.filter((profile) => (profile.user as { status?: string }).status === "active").length,
        availableSlots: availability.reduce((count, slots) => count + slots.reduce((total, slot) => {
          if (slot.booked || slot.end <= now) return total;
          const workingSlots = Math.floor((slot.end.getTime() - Math.max(now.getTime(), slot.start.getTime())) / (30 * 60_000));
          const bookedSlots = slot.bookings?.filter((booking) => booking.start > now).length ?? 0;
          return total + Math.max(0, workingSlots - bookedSlots);
        }, 0), 0),
        upcomingAppointments,
        completedAppointments,
        operationalTasks: null,
        hospitalNotifications: null
      },
      limitations: {
        patientCounts: "unavailable",
        operationalTasks: "No verified hospital-level task association is available.",
        hospitalNotifications: "Only account-specific notifications are available."
      }
    });
  } catch (error) {
    next(error);
  }
};

export const managerHospitalProfile: RequestHandler = async (req, res, next) => {
  try {
    const { user, hospital } = await managerHospital(req.user!.id);
    if (!user) return unavailable(res, "UNAUTHORIZED", 401);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    res.json({
      hospital: {
        id: hospital._id.toString(),
        name: hospital.name,
        code: hospital.code,
        type: hospital.type,
        district: hospital.district,
        mandal: hospital.mandal,
        mandalId: hospital.mandalId,
        address: hospital.address,
        phone: hospital.phone,
        services: hospital.services,
        workingHours: hospital.workingHours,
        lat: hospital.lat,
        lng: hospital.lng,
        active: hospital.active
      },
      manager: {
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        status: user.status,
        mfaEnabled: user.mfaEnabled
      }
    });
  } catch (error) {
    next(error);
  }
};

const managerHospitalProfileSchema = z.object({
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(30).optional(),
  services: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  workingHours: z.record(z.string().max(40), z.unknown()).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one permitted hospital field.");

export const updateManagerHospitalProfile: RequestHandler = async (req, res, next) => {
  try {
    const { user, hospital } = await managerHospital(req.user!.id);
    if (!user) return unavailable(res, "UNAUTHORIZED", 401);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const result = managerHospitalProfileSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Provide valid permitted hospital details." } });
    Object.assign(hospital, result.data);
    await hospital.save();
    await hospitalAudit(req, "edit", "hospital_profile", hospital._id.toString(), hospital._id.toString());
    res.json({ hospital: { id: hospital._id.toString(), address: hospital.address, phone: hospital.phone, services: hospital.services, workingHours: hospital.workingHours } });
  } catch (error) {
    next(error);
  }
};

export const managerDoctorRoster: RequestHandler = async (req, res, next) => {
  try {
    const { hospital } = await managerHospital(req.user!.id);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const query = z.object({
      search: z.string().trim().max(100).optional(),
      specialty: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).strict().parse(req.query);
    const filter: Record<string, unknown> = { hospital: hospital._id };
    if (query.specialty) filter.specialty = new RegExp(query.specialty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const [profiles, total] = await Promise.all([
      DoctorProfile.find(filter)
        .select("user registrationNo specialty availability verificationStatus")
        .populate("user", "_id name username status")
        .sort({ specialty: 1 })
        .lean(),
      DoctorProfile.countDocuments(filter)
    ]);
    const search = query.search?.toLocaleLowerCase();
    const doctors = profiles
      .filter((profile) => {
        if (!profile.user || typeof profile.user !== "object") return false;
        if (!search) return true;
        const user = profile.user as { name?: string; username?: string };
        return [user.name, user.username, profile.specialty, profile.registrationNo]
          .some((value) => value?.toLocaleLowerCase().includes(search));
      })
      .map((profile) => {
        const user = profile.user as { _id: mongoose.Types.ObjectId; name?: string; username?: string; status?: string };
        return {
          id: user._id.toString(),
          name: user.name,
          username: user.username,
          status: user.status,
          specialty: profile.specialty,
          registrationNo: profile.registrationNo,
          verificationStatus: profile.verificationStatus ?? "verified",
          availability: (profile.availability as unknown as AvailabilitySlot[]).filter((slot) => slot.start > new Date()).map((slot) => ({
            id: slot._id.toString(),
            start: slot.start,
            end: slot.end,
            booked: slot.booked || Boolean(slot.bookings?.length)
          }))
        };
      });
    res.json({ doctors: doctors.slice((query.page - 1) * query.limit, query.page * query.limit), total, page: query.page, limit: query.limit });
  } catch (error) {
    next(error);
  }
};

const availabilityInput = z.object({
  start: z.coerce.date(),
  end: z.coerce.date()
}).strict().refine((value) => value.end > value.start, "Schedule end must be after start.");

export const addDoctorAvailability: RequestHandler = async (req, res, next) => {
  try {
    const { hospital } = await managerHospital(req.user!.id);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const doctorId = objectIdSchema.parse(req.params.doctorId);
    const body = availabilityInput.safeParse(req.body);
    if (!body.success || body.data.start <= new Date()) {
      return res.status(400).json({ error: { code: "INVALID_SCHEDULE", message_en: "Choose a future schedule interval with an end after its start." } });
    }
    const profile = await DoctorProfile.findOne({ user: doctorId, hospital: hospital._id, $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }] });
    if (!profile) return unavailable(res, "DOCTOR_NOT_FOUND", 404);
    const availability = profile.availability as unknown as AvailabilitySlot[];
    const overlapsAvailability = availability.some((slot) =>
      slot.start < body.data.end && slot.end > body.data.start);
    const overlapsAppointment = await Appointment.exists({
      clinician: doctorId,
      status: { $in: ["requested", "confirmed", "rescheduled"] },
      startAt: { $lt: body.data.end },
      endAt: { $gt: body.data.start }
    });
    if (overlapsAvailability || overlapsAppointment) {
      return res.status(409).json({ error: { code: "SCHEDULE_CONFLICT", message_en: "The doctor already has an overlapping schedule or appointment." } });
    }
    profile.availability.push({ ...body.data, booked: false });
    await profile.save();
    const slot = profile.availability[profile.availability.length - 1];
    await hospitalAudit(req, "create_schedule", "doctor_availability", slot._id.toString(), hospital._id.toString());
    res.status(201).json({ slot: { id: slot._id.toString(), start: slot.start, end: slot.end, booked: slot.booked } });
  } catch (error) {
    next(error);
  }
};

export const removeDoctorAvailability: RequestHandler = async (req, res, next) => {
  try {
    const { hospital } = await managerHospital(req.user!.id);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const doctorId = objectIdSchema.parse(req.params.doctorId);
    const slotId = objectIdSchema.parse(req.params.slotId);
    const profile = await DoctorProfile.findOne({ user: doctorId, hospital: hospital._id });
    if (!profile) return unavailable(res, "DOCTOR_NOT_FOUND", 404);
    const availability = profile.availability as unknown as AvailabilitySlot[];
    const slot = availability.find((item) => item._id.toString() === slotId);
    if (!slot) return unavailable(res, "SCHEDULE_NOT_FOUND", 404);
    const hasAppointment = await Appointment.exists({
      clinician: doctorId,
      availabilityId: slotId,
      status: { $in: ["requested", "confirmed", "rescheduled"] }
    });
    if (slot.booked || slot.start <= new Date() || hasAppointment) {
      return res.status(409).json({ error: { code: "SCHEDULE_NOT_REMOVABLE", message_en: "Booked or past schedule intervals cannot be removed." } });
    }
    profile.availability.pull({ _id: slot._id });
    await profile.save();
    await hospitalAudit(req, "delete_schedule", "doctor_availability", slotId, hospital._id.toString());
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const medicineKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");

export const managerMedicineInventory: RequestHandler = async (req, res, next) => {
  try {
    const { user, hospital } = await managerHospital(req.user!.id);
    if (!user) return unavailable(res, "UNAUTHORIZED", 401);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const inventory = await MedicineInventory.find({ hospital: hospital._id }).sort({ medicineName: 1 }).lean();
    res.json({ inventory });
  } catch (error) {
    next(error);
  }
};

export const upsertManagerMedicineInventory: RequestHandler = async (req, res, next) => {
  try {
    const { user, hospital } = await managerHospital(req.user!.id);
    if (!user) return unavailable(res, "UNAUTHORIZED", 401);
    if (!hospital) return unavailable(res, "HOSPITAL_INACTIVE", 403);
    const body = z.object({
      medicineName: z.string().trim().min(1).max(160),
      quantity: z.number().int().min(0).max(1_000_000),
      unit: z.string().trim().min(1).max(40)
    }).strict().parse(req.body);
    const key = medicineKey(body.medicineName);
    const existing = await MedicineInventory.findOne({ hospital: hospital._id, medicineKey: key }).select("_id");
    const inventory = await MedicineInventory.findOneAndUpdate(
      { hospital: hospital._id, medicineKey: key },
      { $set: { ...body, medicineKey: key, updatedBy: user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await hospitalAudit(req, existing ? "update_medicine_stock" : "create_medicine_stock", "medicine_inventory", inventory._id.toString(), hospital._id.toString());
    res.status(existing ? 200 : 201).json({ inventory });
  } catch (error) {
    next(error);
  }
};

export const managerNotifications: RequestHandler = async (req, res, next) => {
  try {
    const rows = await Notification.find({ user: req.user!.id })
      .select("_id channel template language status createdAt sentAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ notifications: rows });
  } catch (error) {
    next(error);
  }
};

export const markManagerNotificationRead: RequestHandler = async (req, res, next) => {
  try {
    const id = objectIdSchema.parse(req.params.notificationId);
    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: req.user!.id },
      { $set: { status: "read" } },
      { new: true }
    ).select("_id status");
    if (!notification) return unavailable(res, "NOT_FOUND", 404);
    res.json({ notification });
  } catch (error) {
    next(error);
  }
};
