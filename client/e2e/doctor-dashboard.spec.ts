import { expect, test } from "./fixtures";

test("doctor sign-in requires MFA enrollment before creating a session", async ({ page }) => {
  let sessionRequested = false;
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mfaSetupRequired: true, mfaToken: "synthetic-setup-token" })
  }));
  await page.route("**/api/v1/auth/mfa/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXP" })
  }));
  await page.route("**/api/v1/users/me", (route) => {
    sessionRequested = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/doctor/login");
  await page.getByLabel("Registered email, username, or mobile number").fill("doctor@example.test");
  await page.locator('input[type="password"]').fill("Synthetic-Doctor-Pass-2026!");
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  await expect(page.getByLabel("One-time code")).toBeVisible();
  const demoCode = page.getByText(/^\d{6}\s*· refreshes in \d+s$/);
  await expect(page.getByText("Demo one-time code · development only")).toBeVisible();
  await expect(demoCode).toBeVisible();
  expect((await demoCode.innerText()).match(/^\d{6}/)?.[0]).toBeTruthy();
  expect(sessionRequested).toBe(false);
});

test("verified doctor sees workload and can open the clinical workspace", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "synthetic-doctor-token");
    sessionStorage.setItem("aarogya-auth-token", "synthetic-doctor-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic Doctor", email: "doctor@example.test", role: "doctor" })
  }));
  await page.route("**/api/v1/doctor-profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { specialty: "Oral Medicine", hospital: { name: "Synthetic Hospital" }, verificationStatus: "verified" } })
  }));
  await page.route("**/api/v1/review/queue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cases: [{ _id: "synthetic-case" }] })
  }));
  await page.route("**/api/v1/appointments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ appointments: [{ _id: "synthetic-appointment", type: "video", status: "confirmed", startAt: "2099-01-01T10:00:00.000Z", endAt: "2099-01-01T10:30:00.000Z" }] })
  }));
  await page.route("**/api/v1/follow-ups/assigned", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ followUps: [{ id: "synthetic-follow-up", scheduledAt: "2099-01-02T10:00:00.000Z", status: "scheduled", overdue: false }] })
  }));

  await page.goto("/doctor");

  await expect(page.getByRole("heading", { name: "Doctor Dashboard" })).toBeVisible();
  await expect(page.getByText("Synthetic Hospital")).toBeVisible();
  await expect(page.getByText("Cases awaiting review").locator("..")).toContainText("1");
  await expect(page.getByText("Upcoming appointments").first().locator("..")).toContainText("1");
  await expect(page.getByRole("link", { name: "Review screening cases" })).toHaveAttribute("href", "/doctor/workspace#screening-review");
});

test("doctor with pending verification gets profile guidance without clinical requests", async ({ page }) => {
  let clinicalRequests = 0;
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "synthetic-doctor-token");
    sessionStorage.setItem("aarogya-auth-token", "synthetic-doctor-token");
  });
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic Doctor", role: "doctor" })
  }));
  await page.route("**/api/v1/doctor-profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { verificationStatus: "pending" } })
  }));
  await page.route("**/api/v1/{review/queue,appointments,follow-ups/assigned}", (route) => {
    clinicalRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/doctor");

  await expect(page.getByRole("heading", { name: "Professional verification: pending" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open doctor profile" })).toHaveAttribute("href", "/doctor/profile");
  expect(clinicalRequests).toBe(0);
});

test("doctor uploads multiple document types and submits only after both required types exist", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("aarogya-access-token", "synthetic-doctor-token");
    sessionStorage.setItem("aarogya-auth-token", "synthetic-doctor-token");
  });
  let profile = {
    registrationNo: "TEST-DR-100",
    registrationAuthority: "Synthetic Medical Council",
    specialty: "Oral Medicine",
    qualification: "Dental Degree",
    experienceYears: 5,
    professionalSummary: "",
    verificationStatus: "draft" as "draft" | "pending",
    documents: [] as Array<{ id: string; type: string; originalName: string; size: number; reviewStatus: string; uploadedAt: string }>
  };
  const uploadTypes = ["qualification", "qualification", "registration_certificate", "experience_certificate"];
  const uploadNames = ["qualification-one.pdf", "qualification-two.pdf", "registration.pdf", "experience.pdf"];
  let uploadIndex = 0;
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "synthetic-doctor", name: "Synthetic Doctor", role: "doctor" })
  }));
  await page.route("**/api/v1/doctor-profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile })
  }));
  await page.route("**/api/v1/doctor-profile/documents", async (route) => {
    const formData = route.request().postDataBuffer()?.toString("utf8") ?? "";
    expect(formData).toContain('name="type"');
    expect(formData).toContain('name="file"');
    expect(formData).toContain('name="uploadId"');
    const document = {
      id: `synthetic-document-${uploadIndex}`,
      type: uploadTypes[uploadIndex],
      originalName: uploadNames[uploadIndex],
      size: 32,
      reviewStatus: "uploaded",
      uploadedAt: "2026-01-01T00:00:00.000Z"
    };
    uploadIndex += 1;
    profile.documents.push(document);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document }) });
  });
  await page.route("**/api/v1/doctor-profile/submit", (route) => {
    const types = new Set(profile.documents.map((document) => document.type));
    if (!types.has("registration_certificate") || !types.has("qualification")) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "DOCUMENTS_INCOMPLETE", message_en: "Upload the missing professional registration certificate before submitting." } })
      });
    }
    profile = {
      ...profile,
      verificationStatus: "pending",
      documents: profile.documents.map((document) => ({ ...document, reviewStatus: "pending" }))
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile }) });
  });

  await page.goto("/doctor/profile");
  await expect(page.getByText("Registration certificate: Missing")).toBeVisible();
  await expect(page.getByText("Qualification document: Missing")).toBeVisible();
  await page.getByLabel("Document type").selectOption("qualification");
  for (const filename of ["qualification-one.pdf", "qualification-two.pdf"]) {
    await page.getByLabel(/Choose PDF/).setInputFiles({ name: filename, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nsynthetic document") });
    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Document uploaded and saved." })).toBeVisible();
  }
  await expect(page.getByText("Qualification document · Uploaded").first()).toBeVisible();
  await expect(page.getByText("Qualification document: Uploaded")).toBeVisible();
  await expect(page.getByText("Registration certificate: Missing")).toBeVisible();
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await expect(page.getByText("Upload the missing professional registration certificate before submitting.")).toBeVisible();

  await page.getByLabel("Document type").selectOption("registration_certificate");
  await page.getByLabel(/Choose PDF/).setInputFiles({ name: "registration.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nsynthetic registration") });
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByText("Registration certificate: Uploaded")).toBeVisible();
  await page.getByLabel("Document type").selectOption("experience_certificate");
  await page.getByLabel(/Choose PDF/).setInputFiles({ name: "experience.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nsynthetic experience") });
  await page.getByRole("button", { name: "Upload document" }).click();

  await page.getByRole("button", { name: "Submit for verification" }).click();
  await expect(page.getByText("Verification status: Pending review")).toBeVisible();
  await expect(page.getByText("registration.pdf")).toBeVisible();
  await expect(page.getByText("experience.pdf")).toBeVisible();
  await expect(page.getByText("qualification-one.pdf")).toBeVisible();
  await expect(page.getByText("qualification-two.pdf")).toBeVisible();
});
