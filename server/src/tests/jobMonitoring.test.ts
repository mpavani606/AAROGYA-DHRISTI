import { describe, expect, it } from "@jest/globals";
import { getScheduledJobs, registerScheduledJob, runMonitoredJob } from "../services/jobMonitoring.js";

describe("scheduled job monitoring", () => {
  it("records success and failure state without swallowing job errors", async () => {
    const name = `test-job-${Date.now()}`;
    registerScheduledJob(name, "*/5 * * * *");
    await expect(runMonitoredJob(name, async () => "ok")).resolves.toBe("ok");
    expect(getScheduledJobs().find((job) => job.name === name)).toMatchObject({
      schedule: "*/5 * * * *",
      state: "scheduled",
      runCount: 1
    });

    await expect(runMonitoredJob(name, async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    expect(getScheduledJobs().find((job) => job.name === name)).toMatchObject({
      state: "degraded",
      runCount: 1
    });
  });

  it("rejects monitoring an unregistered job", async () => {
    await expect(runMonitoredJob("unregistered-phase8-test-job", async () => undefined)).rejects.toThrow("was not registered");
  });
});
