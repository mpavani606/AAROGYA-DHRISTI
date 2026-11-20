import { expect, test } from "./fixtures";

test("3D launch opens first and offers a direct ASHA sign-in", async ({ page }) => {
  await page.goto("/?language-unselected");
  await expect(page.getByRole("button", { name: "Open Aarogya Drishti" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "Select your language" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Aarogya Drishti" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await page.getByRole("link", { name: "ASHA worker sign in" }).click();
  await expect(page).toHaveURL(/\/login\?role=asha_worker$/);
  await expect(page.getByRole("tab", { name: "ASHA worker" })).toHaveAttribute("aria-selected", "true");
});

test("returning ASHA users are sent to their dashboard", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "synthetic-asha-access-token");
    sessionStorage.setItem("aarogya-launch-seen", "true");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "synthetic-asha", name: "Synthetic ASHA", role: "asha_worker" } })
  }));

  await page.goto("/");
  await expect(page).toHaveURL(/\/asha$/);
});

test("main home keeps patient and doctor access available", async ({ page }) => {
  await page.goto("/welcome");

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "Aarogya Drishti", exact: true })).toBeVisible();
  await expect(page.locator(".ad-topbar-actions").getByRole("link", { name: "Patient login" })).toBeVisible();
  await expect(page.locator(".ad-topbar-actions").getByRole("link", { name: "Doctor login" })).toBeVisible();

  await page.locator(".ad-topbar-actions").getByRole("link", { name: "Doctor login" }).click();
  await expect(page).toHaveURL(/\/doctor\/login$/);
  await expect(page.getByRole("tablist", { name: "Role" })).toHaveCount(0);
  await expect(page.getByLabel("Registered email, username, or mobile number")).toHaveAttribute("type", "text");
  await expect(page.getByText("Use the email, username, or mobile number from your registration, then enter your password.")).toBeVisible();
  await page.getByRole("button", { name: "Doctor registration" }).click();
  await expect(page).toHaveURL(/\/doctor\/register$/);
  await expect(page.getByRole("heading", { name: "Doctor registration" })).toBeVisible();

  await page.goto("/welcome");
  await page.locator(".ad-topbar-actions").getByRole("link", { name: "Patient login" }).click();
  await expect(page).toHaveURL(/\/patient\/login$/);
  await page.getByRole("link", { name: "Register before signing in" }).click();
  await expect(page).toHaveURL(/\/patient\/register$/);
  await expect(page.getByRole("heading", { name: "Patient registration" })).toBeVisible();
});

test("doctor sign-in authenticates with the registered email and password", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/login", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "synthetic-doctor-access-token",
        user: { id: "synthetic-doctor", name: "Synthetic Test Doctor", role: "doctor", email: "doctor@example.test" }
      })
    });
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "synthetic-doctor", name: "Synthetic Test Doctor", role: "doctor", email: "doctor@example.test" } })
  }));

  await page.goto("/doctor/login");
  await page.getByLabel("Registered email, username, or mobile number").fill("doctor@example.test");
  await page.locator('input[type="password"]').fill("Synthetic-Doctor-Pass-2026!");
  await page.locator("form button[type=submit]").click();

  expect(submitted).toMatchObject({
    identifier: "doctor@example.test",
    password: "Synthetic-Doctor-Pass-2026!",
    role: "doctor"
  });

  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.getByRole("heading", { name: "Synthetic Test Doctor" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.getByRole("heading", { name: "Synthetic Test Doctor" })).toBeVisible();
});

test("patient registration saves consented details and routes to OTP activation", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/patient/register", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ message: "Registration saved." }) });
  });

  await page.goto("/patient/register");
  await page.getByLabel("Full name").fill("Synthetic patient");
  await page.getByRole("textbox", { name: "Mobile number" }).fill("+919000000061");
  await page.getByRole("spinbutton", { name: "Age" }).fill("42");
  await page.getByLabel("District").fill("Synthetic district");
  await page.getByLabel("Mandal").fill("Synthetic mandal");
  await page.getByLabel("Village").fill("Synthetic village");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Register patient" }).click();

  await expect(page).toHaveURL(/\/patient\/login\?registered=1$/);
  await expect(page.getByText("Registration saved. Verify your mobile number to activate your account.")).toBeVisible();
  expect(submitted).toMatchObject({
    name: "Synthetic patient",
    phone: "+919000000061",
    age: 42,
    district: "Synthetic district",
    mandal: "Synthetic mandal",
    village: "Synthetic village",
    consent: true
  });
  expect(submitted).not.toHaveProperty("role");
});

test("patient screening requires recorded consent and uses the patient's own record", async ({ page }) => {
  let screeningConsent = false;
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000062" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "507f1f77bcf86cd799439011", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/patients/507f1f77bcf86cd799439011/consents/screening", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ granted: screeningConsent })
  }));
  await page.route("**/api/v1/patients/507f1f77bcf86cd799439011/consents", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ purpose: "screening", granted: true, consentVersion: "simulation-screening-v1" });
    screeningConsent = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ consent: body }) });
  });

  await page.goto("/patient/cases");
  await page.getByRole("link", { name: "Review screening consent" }).click();
  await expect(page).toHaveURL(/\/patient\/screening$/);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to screening" }).click();
  await expect(page).toHaveURL(/\/patient\/cases$/);
  await expect(page.getByRole("heading", { name: "Community case check" })).toBeVisible();
});

test("patient screening handles unavailable camera and validates image selection", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException("Camera permission denied", "NotAllowedError"); } }
    });
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000062" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "507f1f77bcf86cd799439011", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/patients/507f1f77bcf86cd799439011/consents/screening", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ granted: true })
  }));

  await page.goto("/patient/cases");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Camera guide" }).click();
  await page.getByRole("button", { name: "Camera guide" }).click();
  await expect(page.getByRole("alert")).toContainText("Camera access is unavailable");

  await page.getByLabel("Choose an image").setInputFiles({
    name: "screening.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S9sAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.getByRole("heading", { name: "Image preview" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Capture site Tongue" })).toBeVisible();

  await page.getByRole("button", { name: "Recapture" }).click();
  await page.getByLabel("Choose an image").setInputFiles({
    name: "screening.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")
  });
  await expect(page.getByRole("alert")).toContainText("Choose a JPEG, PNG, or WebP image smaller than 9 MB");
});

test("patient can submit an oral image and download its screening report", async ({ page }) => {
  let reportRequested = false;
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000062" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "507f1f77bcf86cd799439011", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/patients/507f1f77bcf86cd799439011/consents/screening", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ granted: true })
  }));
  await page.route("**/api/v1/ai/quality-check", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ pass: true })
  }));
  await page.route("**/api/v1/sync/batch", (route) => {
    const body = route.request().postDataJSON() as { operations: Array<{ clientUuid: string }> };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: body.operations.map((operation) => ({ clientUuid: operation.clientUuid, status: "synced", entityId: "507f1f77bcf86cd799439012" })) })
    });
  });
  await page.route("**/api/v1/cases/507f1f77bcf86cd799439012/images", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ geminiObservation: { status: "provider_unavailable" } })
  }));
  await page.route("**/api/v1/cases/507f1f77bcf86cd799439012/screening-report", async (route) => {
    reportRequested = true;
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-synthetic-report" });
  });

  await page.goto("/patient/cases");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Choose an image").setInputFiles({
    name: "oral-screening.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S9sAAAAASUVORK5CYII=", "base64")
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Submit when connected" }).click();
  await expect(page.getByRole("button", { name: "Download screening report" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download screening report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("oral-screening-99439012.pdf");
  expect(reportRequested).toBe(true);
});

test("language switch keeps entered login data and translated simulation banner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("SIMULATION - NOT FOR CLINICAL USE", { exact: true })).toBeVisible();

  await page.getByLabel("Phone").fill("9000000041");
  await page.getByRole("button", { name: "తెలుగు" }).click();

  await expect(page.getByLabel("ఫోన్")).toHaveValue("9000000041");
  await expect(page.getByText("సిమ్యులేషన్", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "EN" })).toBeVisible();
});

test("patient registration alias and mobile OTP sign-in work", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aarogya-language", "te"));
  let requestedPhone: string | undefined;
  await page.route("**/api/v1/auth/patient/otp/request", async (route) => {
    requestedPhone = (route.request().postDataJSON() as { phone: string }).phone;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ challengeId: "synthetic-challenge" }) });
  });
  await page.route("**/api/v1/auth/patient/otp/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ challengeId: "synthetic-challenge", code: "123456" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "test-access-token",
        user: { id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000042" }
      })
    });
  });

  await page.goto("/register");
  await expect(page).toHaveURL(/\/patient\/register$/);
  await page.goto("/patient/login");
  await expect(page).toHaveURL(/\/patient\/login$/);
  await expect(page.getByRole("heading", { name: "రోగి సైన్ ఇన్" })).toBeVisible();
  await expect(page.getByText("సిమ్యులేషన్", { exact: false })).toBeVisible();
  await page.getByLabel("మొబైల్ నంబర్").fill("+919000000042");
  await page.getByRole("button", { name: "ధృవీకరణ కోడ్ పంపండి" }).click();

  await expect.poll(() => requestedPhone).toBe("+919000000042");
  await page.getByLabel("ఆరు అంకెల ధృవీకరణ కోడ్").fill("123456");
  await page.getByRole("button", { name: "ధృవీకరించి సైన్ ఇన్ చేయండి" }).click();
  await expect(page).toHaveURL(/\/patient-dashboard$/);
});

test("tobacco support creates and completes a patient cessation plan", async ({ page }) => {
  let plans: Array<{ _id: string; goal: string; status: string }> = [];
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000051" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "synthetic-record", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/patients/synthetic-record/cessation-plans**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plans }) });
      return;
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { goal: string };
      plans = [{ _id: "synthetic-plan", goal: body.goal, status: "active" }];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ plan: plans[0] }) });
      return;
    }
    plans = plans.map((plan) => ({ ...plan, status: "completed" }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: plans[0] }) });
  });

  await page.goto("/tobacco");
  await expect(page.getByRole("heading", { name: "Tobacco cessation support" })).toBeVisible();
  await page.getByLabel("My goal").fill("Discuss quitting with my care team");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByRole("heading", { name: "Discuss quitting with my care team" })).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText(/completed/)).toBeVisible();
});

test("dashboard loads and marks real-time notifications through the API", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("aarogya-launch-seen", "true"));
  let notificationStatus = "queued";
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000052" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "synthetic-record", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/patients/synthetic-record/timeline", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [] })
  }));
  await page.route("**/api/v1/appointments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ appointments: [] })
  }));
  await page.route("**/api/v1/patients/synthetic-record/cessation-plans", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ plans: [] })
  }));
  await page.route("**/api/v1/notifications", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ notifications: [{ _id: "synthetic-notice", template: "appointment_update", status: notificationStatus, createdAt: "2026-11-10T12:00:00.000Z" }] })
  }));
  await page.route("**/api/v1/notifications/synthetic-notice/read", async (route) => {
    notificationStatus = "read";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notification: { _id: "synthetic-notice", status: notificationStatus } }) });
  });

  await page.goto("/home");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("appointment update")).toBeVisible();
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.locator(".rd-notifications article small")).toContainText(/· read/i);
});

test("patient appointment requests use the selected active doctor and return persisted requests", async ({ page }) => {
  let created: Record<string, unknown> | undefined;
  const start = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000053" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "synthetic-record", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/doctors/available", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      hospitals: [{ _id: "synthetic-hospital", name: "Synthetic Hospital" }],
      doctors: [{
        _id: "synthetic-doctor", name: "Dr. Synthetic", hospitalId: "synthetic-hospital",
        hospitalName: "Synthetic Hospital", specialty: "General Medicine"
      }]
    })
  }));
  await page.route("**/api/v1/doctors/synthetic-doctor/slots", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ slots: [{ id: "slot-1", availabilityId: "availability-1", start, end }] })
  }));
  await page.route("**/api/v1/appointments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ appointments: created ? [{ _id: "synthetic-appointment", ...created, status: "requested" }] : [] })
  }));
  await page.route("**/api/v1/appointments/me", async (route) => {
    created = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ appointment: { _id: "synthetic-appointment", ...created, status: "requested" } }) });
  });

  await page.goto("/appointments");
  await expect(page.getByRole("heading", { name: "Request an appointment" })).toBeVisible();
  await page.getByLabel("Doctor and speciality").selectOption("synthetic-doctor");
  await page.getByLabel("Available consultation schedule").selectOption("slot-1");
  await page.getByRole("button", { name: "Request appointment" }).click();
  await expect.poll(() => created?.clinicianId).toBe("synthetic-doctor");
  await expect.poll(() => created?.availabilityId).toBe("availability-1");
  expect(created).not.toHaveProperty("patientId");
  await expect(page.getByText("requested", { exact: true })).toBeVisible();
});

test("patient appointment booking explains when the requested slot is unavailable", async ({ page }) => {
  const start = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000054" })
  }));
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ patient: { _id: "synthetic-record", name: "Synthetic patient" } })
  }));
  await page.route("**/api/v1/doctors/available", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      hospitals: [{ _id: "synthetic-hospital", name: "Synthetic Hospital" }],
      doctors: [{
        _id: "synthetic-doctor", name: "Dr. Synthetic", hospitalId: "synthetic-hospital",
        hospitalName: "Synthetic Hospital", specialty: "General Medicine"
      }]
    })
  }));
  await page.route("**/api/v1/doctors/synthetic-doctor/slots", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ slots: [{ id: "slot-1", availabilityId: "availability-1", start, end }] })
  }));
  await page.route("**/api/v1/appointments", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ appointments: [] })
  }));
  await page.route("**/api/v1/appointments/me", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "SLOT_UNAVAILABLE", message_en: "That appointment slot is unavailable." } })
    });
  });

  await page.goto("/appointments");
  await page.getByLabel("Doctor and speciality").selectOption("synthetic-doctor");
  await page.getByLabel("Available consultation schedule").selectOption("slot-1");
  await page.getByRole("button", { name: "Request appointment" }).click();
  await expect(page.getByRole("alert")).toHaveText("That appointment slot is unavailable.");
});

test("patient account cannot open the doctor portal", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-patient", name: "Synthetic patient", role: "patient", phone: "9000000045" })
  }));

  await page.goto("/doctor");

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Aarogya Drishti" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oral Health Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doctor review" })).toHaveCount(0);
  await page.getByRole("button", { name: "తెలుగు" }).click();
  await expect(page.getByRole("heading", { name: "నోటి ఆరోగ్య అవలోకనం" })).toBeVisible();
});

test("doctor disagreement remains distinct from the demo AI state", async ({ page }) => {
  let reviewPayload: Record<string, unknown> | undefined;
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic doctor", role: "doctor", phone: "9000000046" })
  }));
  await page.route("**/api/v1/doctor-profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { verificationStatus: "verified", documents: [] } })
  }));
  await page.route("**/api/v1/review/queue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cases: [{ _id: "synthetic-case", status: "ai_processed", priorityBand: "review", patient: { patientCode: "ADP-SYNTHETIC" } }] })
  }));
  await page.route("**/api/v1/cases/synthetic-case/care-overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cases: [], referrals: [], appointments: [], followUps: [] })
  }));
  await page.route("**/api/v1/cases/synthetic-case/clinical-summary", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ summary: {
      case: { notes: "Synthetic screening note.", workflowPriority: "review", status: "ai_processed" },
      patientHistory: { association: "patient_profile; reporter not recorded; not linked to this specific case", symptoms: [], habits: [] },
      recordedRiskIndicators: { score: null, factors: [], disclaimer: "Not a validated clinical risk assessment." },
      imageHistory: [],
      doctorAssessment: { status: "not_reviewed" },
      aiSummary: { status: "unavailable", aiGenerated: false },
      disclaimer: "Not a diagnosis."
    } })
  }));
  await page.route("**/api/v1/cases/synthetic-case/images", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ images: [{
      id: "synthetic-image",
      qualityStatus: "usable",
      createdAt: new Date().toISOString(),
      aiResult: {
        status: "demo_not_validated",
        clinicallyValidated: false,
        model: { name: "Synthetic demo model", version: "test" },
        processedAt: new Date().toISOString()
      }
    }] })
  }));
  await page.route("**/api/v1/cases/synthetic-case/images/synthetic-image", (route) => route.fulfill({
    status: 200,
    contentType: "image/gif",
    body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64")
  }));
  await page.route("**/api/v1/cases/synthetic-case/review", async (route) => {
    reviewPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ review: { _id: "synthetic-review" } }) });
  });
  await page.route("**/api/v1/cases/synthetic-case/sign", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ review: { _id: "synthetic-review" } }) }));
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/doctor/workspace");
  await page.getByRole("button", { name: /ADP-SYNTHETIC/ }).click();
  await expect(page.getByText("Clinical decisions remain separate from demonstration AI output.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Structured clinical summary" })).toBeVisible();
  await expect(page.getByText("Validated AI summary unavailable")).toBeVisible();
  await expect(page.getByText("Demonstration model only; no clinically validated AI observation is available.")).toBeVisible();
  await expect(page.getByText("Suspicious features require professional review")).toHaveCount(0);
  await page.locator("#doctor-decision").selectOption("disagree");
  await page.locator("#doctor-reason").fill("Synthetic clinician review differs from demo output.");
  await page.getByRole("button", { name: /Save independent doctor review/ }).click();

  await expect.poll(() => reviewPayload?.decision).toBe("disagree");
  await expect.poll(() => reviewPayload?.aiAgreement).toBe("disagree");
});

test("verified doctor can create a referral and follow-up for an authorized case", async ({ page }) => {
  let referralPayload: Record<string, unknown> | undefined;
  let followUpPayload: Record<string, unknown> | undefined;
  let caseCare: { cases: unknown[]; referrals: Array<Record<string, unknown>>; appointments: unknown[]; followUps: unknown[] } = {
    cases: [],
    referrals: [],
    appointments: [],
    followUps: []
  };
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic doctor", role: "doctor", phone: "9000000046" })
  }));
  await page.route("**/api/v1/doctor-profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { verificationStatus: "verified", documents: [] } })
  }));
  await page.route("**/api/v1/review/queue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cases: [{ _id: "synthetic-case", status: "ai_processed", priorityBand: "review", patient: { patientCode: "ADP-SYNTHETIC" } }] })
  }));
  await page.route("**/api/v1/patients", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ patients: [] }) }));
  await page.route("**/api/v1/referral-destinations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ destinations: [{ _id: "synthetic-hospital", name: "Synthetic destination" }] })
  }));
  await page.route("**/api/v1/follow-ups/assigned", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ followUps: [] })
  }));
  await page.route("**/api/v1/cases/synthetic-case/care-overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(caseCare)
  }));
  await page.route("**/api/v1/cases/synthetic-case/images", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ images: [] })
  }));
  await page.route("**/api/v1/cases/synthetic-case/referrals", async (route) => {
    referralPayload = route.request().postDataJSON() as Record<string, unknown>;
    caseCare = { ...caseCare, referrals: [{ id: "synthetic-referral", reference: "AD-R-SYNTHETIC", caseId: "synthetic-case", destination: { name: "Synthetic destination" }, specialty: "Oral health", status: "requested" }] };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ referral: { _id: "synthetic-referral" } }) });
  });
  await page.route("**/api/v1/cases/synthetic-case/follow-ups", async (route) => {
    followUpPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ followUp: { id: "synthetic-follow-up" } }) });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/doctor/workspace");
  await page.getByRole("button", { name: /ADP-SYNTHETIC/ }).click();
  await page.getByLabel("Destination hospital").selectOption("synthetic-hospital");
  await page.getByLabel("Specialty").fill("Oral health");
  await page.getByLabel("Referral reason").fill("Synthetic case requires a specialist review.");
  await page.getByRole("button", { name: "Create referral" }).click();
  await expect.poll(() => referralPayload?.hospital).toBe("synthetic-hospital");

  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await page.getByLabel("Follow-up date and time").fill(future);
  await page.getByLabel("Authorized care notes").fill("Synthetic follow-up note.");
  await page.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect.poll(() => followUpPayload?.notes).toBe("Synthetic follow-up note.");
});

test("poor image remains unassessed and does not trigger an AI request", async ({ page }) => {
  let aiRequests = 0;
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic doctor", role: "doctor", phone: "9000000047" })
  }));
  await page.route("**/api/v1/ai/**", async (route) => {
    aiRequests += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await page.goto("/doctor/cases");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-poor.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([1, 2, 3])
  });

  await expect(page.getByRole("heading", { name: "Image preview" })).toBeVisible();
  await expect(page.locator(".case-panel")).toContainText("Review needed");
  await expect(page.getByText("Not assessed", { exact: true })).toBeVisible();
  expect(aiRequests).toBe(0);
});

test("offline Telugu registration retries after network failure without creating duplicates", async ({ page, context }) => {
  let batchRequests = 0;
  let patientClientUuid: string | undefined;
  let syncedPreferredLanguage: unknown;
  await page.addInitScript(() => {
    localStorage.setItem("aarogya-language", "te");
    sessionStorage.setItem("aarogya-access-token", "test-access-token");
    sessionStorage.setItem("aarogya-auth-token", "test-access-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic doctor", role: "doctor", phone: "9000000043" })
  }));
  await page.route("**/api/v1/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) }));
  await page.route("**/api/v1/patients/duplicate-check", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ duplicate: false, matches: [] })
  }));
  await page.route("**/api/v1/sync/batch", async (route) => {
    batchRequests += 1;
    const body = route.request().postDataJSON() as { operations: Array<{ clientUuid: string; payload: { preferredLanguage?: string } }> };
    const patientOperations = body.operations.filter((operation) => "preferredLanguage" in operation.payload);
    expect(patientOperations).toHaveLength(1);
    if (batchRequests === 1) {
      patientClientUuid = patientOperations[0]?.clientUuid;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic network failure" }) });
      return;
    }
    expect(patientOperations[0]?.clientUuid).toBe(patientClientUuid);
    syncedPreferredLanguage = patientOperations[0]?.payload.preferredLanguage;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: body.operations.map(({ clientUuid }) => ({
          clientUuid,
          status: "synced",
          entityId: "507f1f77bcf86cd799439011",
          patientCode: "ADP-SYNTHETIC",
          tokenNo: "AD-PAD-000001"
        }))
      })
    });
  });
  await page.route("**/api/v1/sync/pull?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ pulledAt: new Date().toISOString(), assignments: [], appointments: [], recaptureRequests: [], education: [] })
  }));

  await page.goto("/patient/new");
  await expect(page.getByRole("heading", { name: "కొత్త రోగి నమోదు" })).toBeVisible();
  await page.getByRole("button", { name: "Set offline PIN" }).click();
  await page.getByLabel("PIN", { exact: true }).fill("1234");
  await page.getByRole("button", { name: /Set PIN/ }).click();
  await expect(page.getByRole("button", { name: "Lock data" })).toBeVisible();
  await page.getByRole("button", { name: "నా వద్ద ABHA లేదు" }).click();
  await page.getByRole("button", { name: "కొనసాగించండి" }).click();
  await page.getByRole("button", { name: "కొనసాగించండి" }).click();
  await page.getByRole("button", { name: "కొనసాగించండి" }).click();
  await page.getByLabel("పూర్తి పేరు").fill("సింథటిక్ రోగి");
  await page.getByLabel("ఫోన్ నంబర్").fill("9000000044");
  await page.getByLabel("మండలం").fill("డెమో మండలం");
  await page.getByLabel("చిరునామా").fill("డెమో గ్రామం");
  await page.getByRole("button", { name: "కొనసాగించండి" }).click();
  await page.getByRole("button", { name: "కొనసాగించండి" }).click();
  await context.setOffline(true);
  await page.getByLabel("నమోదుకు నా సమ్మతి ఉంది").check();
  await page.getByRole("button", { name: "నమోదు సేవ్ చేయండి" }).click();
  await expect(page.getByText("ఆఫ్‌లైన్‌లో సేవ్ అయింది.", { exact: false })).toBeVisible();
  const localRegistration = await page.evaluate(async () => {
    const request = indexedDB.open("aarogya-drishti-outbox");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const transaction = database.transaction("registrations", "readonly");
      const getAll = transaction.objectStore("registrations").getAll();
      getAll.onsuccess = () => resolve(getAll.result as Array<Record<string, unknown>>);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    return JSON.stringify(rows);
  });
  expect(localRegistration).not.toContain("సింథటిక్ రోగి");
  expect(localRegistration).not.toContain("9000000044");
  expect(localRegistration).toContain("encryptedDraft");

  await context.setOffline(false);
  await expect.poll(() => batchRequests).toBe(1);
  await page.waitForTimeout(2300);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => batchRequests).toBe(2);
  await expect.poll(() => syncedPreferredLanguage).toBe("te");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => batchRequests).toBe(2);
});

test("district dashboard keeps all mandals and dashboard sections on one page", async ({ page }) => {
  const mandalFilters: string[] = [];
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      accessToken: "test-access-token",
      user: { id: "synthetic-admin", name: "Synthetic admin", role: "district_admin", phone: "9000000048" }
    })
  }));
  await page.route("**/api/v1/geo/mandals", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mandals: [
      { _id: "507f1f77bcf86cd799439011", name_en: "Ananthagiri", name_te: "అనంతగిరి", villageCount: 6, habitationCount: 12 },
      { _id: "507f1f77bcf86cd799439012", name_en: "Araku Valley", name_te: "అరకు లోయ", villageCount: 8, habitationCount: 15 }
    ] })
  }));
  await page.route("**/api/v1/dashboard/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").pop();
    if (endpoint === "summary") mandalFilters.push(url.searchParams.get("mandalId") ?? "");
    const data = endpoint === "summary" ? { summary: {
      screeningCoverage: 50, screeningCoverageDenominator: 2, screenedAdults: 1, usableImageRate: 80, imagesAssessed: 5,
      medianHoursToReview: 2, referralCompletionRate: 50, medianDaysToDiagnosis: 3, biopsyCompletionRate: 50,
      treatmentLinkageRate: 25, lossToFollowUpRate: 0, cessationUptake: 10, notificationSuccessRate: 90,
      missedAppointments: 1, metricNotes: { screeningCoverage: "Synthetic dashboard data." }
    } } : endpoint === "hotspots" ? { hotspots: [{ villageId: "village-1", name: "Sample Village", mandalId: "507f1f77bcf86cd799439011", phcId: "phc-1", lat: null, lng: null, screened: 6 }] }
      : endpoint === "data-quality" ? { dataQuality: { missingVillage: 1, duplicatePhoneGroups: 0, impossibleAges: 0, patientsWithRepeatedPoorImages: 0, pendingSyncTooLong: null, pendingSyncNote: "Not available." } }
        : { villages: [{ villageId: "village-1", name: "Sample Village", totalHabitations: 8, screenedHabitations: 6, pendingHabitations: 2, averageCoverage: 75 }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });

  await page.goto("/login");
  await page.getByRole("tab", { name: /District admin/ }).click();
  await page.getByLabel("Phone").fill("9000000048");
  await page.locator('input[type="password"]').fill("Demo12345!");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole("button", { name: /Ananthagiri/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Araku Valley/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data quality" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Village coverage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ASHA activity" })).toBeVisible();
  await expect(page.getByText("Sample Village").first()).toBeVisible();

  await page.getByRole("button", { name: /Ananthagiri/ }).click();
  await expect.poll(() => mandalFilters.at(-1)).toBe("507f1f77bcf86cd799439011");
});
