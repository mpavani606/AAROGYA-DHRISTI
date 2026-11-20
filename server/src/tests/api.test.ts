import { describe, expect, it } from "@jest/globals";
import request from "supertest";
import { app } from "../app.js";
import { getRequestMetrics } from "../middleware/requestMetrics.js";

describe("API security and health", () => {
  it("serves an unauthenticated, database-independent health response", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "aarogya-drishti-api" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("requires authentication for Phase 08 analytics, monitoring, and exports", async () => {
    const before = getRequestMetrics();
    const responses = await Promise.all([
      request(app).get("/api/v1/analytics/overview"),
      request(app).get("/api/v1/ai-monitoring"),
      request(app).get("/api/v1/system-health"),
      request(app).get("/api/v1/operational-reports")
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    const after = getRequestMetrics();
    expect(after.totalRequests).toBeGreaterThanOrEqual(before.totalRequests + 4);
    expect(after.errorRequests).toBeGreaterThanOrEqual(before.errorRequests + 4);
  });

  it("requires authentication on the reset endpoint", async () => {
    const response = await request(app)
      .post("/api/v1/admin/reset-demo")
      .send({ confirmation: "RESET SYNTHETIC DEMO" });
    expect(response.status).toBe(401);
  });

  it("requires authentication before hospital manager administration", async () => {
    const response = await request(app).get("/api/v1/admin/hospital-managers");
    expect(response.status).toBe(401);
  });

  it("requires authentication before patient directory access", async () => {
    const response = await request(app).get("/api/v1/patients");
    expect(response.status).toBe(401);
  });

  it("requires authentication for the ASR hospital and doctor directory", async () => {
    const responses = await Promise.all([
      request(app).get("/api/v1/facility-directory"),
      request(app).get("/api/v1/facility-directory/507f1f77bcf86cd799439011")
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401]);
  });

  it("requires authentication for prescription and medicine CRUD endpoints", async () => {
    const responses = await Promise.all([
      request(app).get("/api/v1/prescriptions"),
      request(app).get("/api/v1/prescriptions/507f1f77bcf86cd799439011"),
      request(app).get("/api/v1/prescriptions/507f1f77bcf86cd799439011/pdf"),
      request(app).post("/api/v1/prescriptions").send({}),
      request(app).get("/api/v1/medicines"),
      request(app).post("/api/v1/medicines").send({}),
      request(app).patch("/api/v1/medicines/507f1f77bcf86cd799439011").send({}),
      request(app).delete("/api/v1/medicines/507f1f77bcf86cd799439011")
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(401));
  });

  it("requires patient authentication before assigned-worker and health-camp access", async () => {
    const responses = await Promise.all([
      request(app).get("/api/v1/patients/me/health-workers"),
      request(app).get("/api/v1/community/camps/mine"),
      request(app).post("/api/v1/community/camps/507f1f77bcf86cd799439011/register")
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it("requires authentication before Phase 07 case-care and follow-up access", async () => {
    const responses = await Promise.all([
      request(app).get("/api/v1/cases/507f1f77bcf86cd799439011/care-overview"),
      request(app).get("/api/v1/follow-ups/assigned"),
      request(app).get("/api/v1/referral-destinations")
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it("rejects unsigned local medical media links", async () => {
    const response = await request(app).get("/api/v1/media/not-a-valid-storage-key?expires=9999999999999&signature=invalid");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INVALID_MEDIA_SIGNATURE");
  });

  it("does not allow an unlisted browser origin", async () => {
    const response = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://not-allowed.example");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves the OpenAPI specification and Swagger UI", async () => {
    const specification = await request(app).get("/api-docs.json");
    expect(specification.status).toBe(200);
    expect(specification.body.openapi).toBe("3.0.3");

    const ui = await request(app).get("/api-docs/");
    expect(ui.status).toBe(200);
    expect(ui.text).toContain("swagger-ui");
  });
});
