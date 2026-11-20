# Hackathon demo script

All records in this walkthrough are synthetic. Keep the **SIMULATION - NOT FOR CLINICAL USE** banner visible.

1. Sign in as `asha.demo@demo.local` (password `Demo12345!`). ASHA worker, doctor, and administrator accounts require first-time TOTP enrollment; local development displays a short-lived demo code during setup.
2. Switch between తెలుగు, EN and हिंदी; show that the current form value remains entered.
3. Register a synthetic patient in G. Madugula and show the duplicate check and generated token.
4. Open the seeded 46-year-old hero case. Explain that its white-patch/tobacco history is fabricated for workflow demonstration only.
5. Show the deliberately blurred, dark and glare-filled synthetic samples. Each is stored as insufficient; the AI state is `image_insufficient`.
6. Open the AI panel and show its model provenance, timestamp, localization set to null and NOT FOR CLINICAL USE label.
7. Open the clinician review and simulated report. Emphasize that the report is fabricated and the clinical conclusion is a separate record.
8. Show the specialist video appointment, physical appointment, token, and navigator follow-up task. SMS templates contain appointment logistics only.
9. Open the district dashboard and export only aggregate data; small village counts display as `<5`.
10. With DevTools Network Offline, save a new synthetic draft, show its offline status, restore connectivity and trigger sync. Repeat the sync to demonstrate duplicate-safe behavior.
11. Attempt a patient/case URL from an account outside its assignment and show the 403 response/audit event.
12. If asked to restore the demo data, sign in as system admin and use `POST /api/v1/admin/reset-demo` with `{ "confirmation": "RESET SYNTHETIC DEMO" }`.

Never enter real patient information or present the demonstration model as a diagnostic tool.
