import { expect, test } from "./fixtures";

test("hospital manager deep links request Hospital ID and manager username", async ({ page }) => {
  await page.goto("/hospital-manager");

  await expect(page).toHaveURL(/\/login\?role=hospital_manager$/);
  await expect(page.getByRole("tab", { name: /Hospital manager/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Hospital ID / code")).toBeVisible();
  await expect(page.getByLabel("Manager username")).toBeVisible();
});

test("password setup requires the one-time setup link", async ({ page }) => {
  await page.goto("/hospital-manager/setup");

  await expect(page.getByRole("heading", { name: "Set your manager password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set password" })).toBeDisabled();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("hospital manager dashboard shows assigned operations without patient records", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("aarogya-access-token", "synthetic-ui-token"));
  let scheduleCreated = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });

    if (path.endsWith("/users/me")) {
      await json({ user: { id: "synthetic-manager", name: "Synthetic Manager", role: "hospital_manager" } });
    } else if (path.endsWith("/hospital-manager/dashboard")) {
      await json({
        hospital: { id: "synthetic-hospital", name: "Synthetic Hospital A", code: "TEST-A" },
        counts: { doctors: 1, activeDoctors: 1, availableSlots: 0, upcomingAppointments: 2, completedAppointments: 3 },
        limitations: { patientCounts: "unavailable", operationalTasks: "No linked operational tasks", hospitalNotifications: "Account-specific only" }
      });
    } else if (path.endsWith("/hospital-manager/hospital") && route.request().method() === "PATCH") {
      await json({ hospital: { id: "synthetic-hospital" } });
    } else if (path.endsWith("/hospital-manager/hospital")) {
      await json({
        hospital: { id: "synthetic-hospital", name: "Synthetic Hospital A", code: "TEST-A", type: "PHC", active: true, address: "", phone: "", services: [] },
        manager: { id: "synthetic-manager", name: "Synthetic Manager", username: "manager-a", status: "active", mfaEnabled: true }
      });
    } else if (path.endsWith("/hospital-manager/doctors")) {
      await json({ doctors: [{ id: "synthetic-doctor", name: "Synthetic Doctor", status: "active", specialty: "General Practice", availability: [] }], total: 1 });
    } else if (path.endsWith("/hospital-manager/notifications")) {
      await json({ notifications: [] });
    } else if (path.endsWith("/hospital-manager/medicine-inventory")) {
      await json({ inventory: [] });
    } else if (path.endsWith("/availability") && route.request().method() === "POST") {
      scheduleCreated = true;
      await json({ slot: { id: "synthetic-slot", booked: false } }, 201);
    } else {
      await json({});
    }
  });

  await page.goto("/hospital-manager");
  await expect(page.getByRole("heading", { name: "Hospital manager dashboard" })).toBeVisible();
  await expect(page.getByText("Synthetic Hospital A")).toBeVisible();
  await expect(page.getByText("Patient-level records and clinical screening information are not available in this operational view.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Synthetic Doctor" })).toBeVisible();

  const start = new Date(Date.now() + 2 * 24 * 60 * 60_000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByRole("combobox", { name: "Doctor" }).selectOption("synthetic-doctor");
  await page.getByLabel("Starts").fill(localInput(start));
  await page.getByLabel("Ends").fill(localInput(end));
  await page.getByRole("button", { name: "Add availability" }).click();
  await expect.poll(() => scheduleCreated).toBe(true);
});

test("system admin can assign an unassigned doctor to an active hospital", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("aarogya-access-token", "synthetic-admin-token"));
  let assigned = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });

    if (path.endsWith("/users/me")) {
      await json({ user: { id: "synthetic-admin", name: "Synthetic Admin", role: "system_admin" } });
    } else if (path.endsWith("/geo/mandals")) {
      await json({ mandals: [] });
    } else if (path.endsWith("/admin/overview")) {
      await json({ statistics: { totalHospitals: 1, activeHospitals: 1, inactiveHospitals: 0, totalDoctors: 1, activeDoctors: 1, hospitalManagers: 0 }, hospitals: [] });
    } else if (path.endsWith("/admin/hospitals")) {
      await json({ hospitals: [{ _id: "synthetic-hospital", name: "Synthetic Hospital A", code: "TEST-A", type: "PHC", active: true }] });
    } else if (path.endsWith("/admin/doctors")) {
      await json({ doctors: [{
        _id: "synthetic-doctor",
        name: "Synthetic Doctor",
        username: "doctor-a",
        email: "doctor@example.test",
        phone: "9000000000",
        status: "active",
        hospitalProfile: assigned ? { registrationNo: "SYN-REG-1", specialty: "General Practice", hospital: { name: "Synthetic Hospital A", code: "TEST-A" } } : null,
        assignments: []
      }] });
    } else if (path.endsWith("/admin/doctors/synthetic-doctor/hospital-profile") && route.request().method() === "POST") {
      assigned = true;
      await json({ profile: { id: "synthetic-profile" } }, 201);
    } else {
      await json({});
    }
  });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Hospital network overview" })).toBeVisible();
  await page.getByRole("button", { name: "Doctors", exact: true }).click();
  await page.getByRole("combobox", { name: "Doctor" }).selectOption("synthetic-doctor");
  await page.getByRole("combobox", { name: "Hospital name" }).selectOption("synthetic-hospital");
  await page.getByLabel("Professional registration number").fill("SYN-REG-1");
  await page.getByLabel("Specialty").fill("General Practice");
  await page.getByRole("button", { name: "Assign doctor to hospital" }).click();
  await expect(page.getByText(/Hospital profile: Synthetic Hospital A/)).toBeVisible();
});
