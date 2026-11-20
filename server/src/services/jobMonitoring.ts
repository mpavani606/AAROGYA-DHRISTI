type JobStatus = {
  name: string;
  schedule: string;
  state: "scheduled" | "running" | "degraded";
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastFailedAt?: string;
  runCount: number;
};

const jobs = new Map<string, JobStatus>();

export function registerScheduledJob(name: string, schedule: string) {
  jobs.set(name, { name, schedule, state: "scheduled", runCount: 0 });
}

export async function runMonitoredJob<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const job = jobs.get(name);
  if (!job) throw new Error(`Scheduled job "${name}" was not registered.`);
  job.state = "running";
  job.lastStartedAt = new Date().toISOString();
  try {
    const result = await operation();
    job.state = "scheduled";
    job.lastCompletedAt = new Date().toISOString();
    job.runCount += 1;
    return result;
  } catch (error) {
    job.state = "degraded";
    job.lastFailedAt = new Date().toISOString();
    throw error;
  }
}

export function getScheduledJobs() {
  return [...jobs.values()].map((job) => ({ ...job }));
}
