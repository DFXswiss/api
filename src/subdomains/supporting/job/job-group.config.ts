import { Process } from 'src/shared/services/process.service';
import { JobGroup } from './enums';

export interface JobGroupConfig {
  maxWaitSeconds: number;
  maxRunSeconds: number;
  maxAttempts: number;
  exposeResult: boolean;
}

// Defaults are the source of truth when the settings table has no override (key `jobGroups`).
// Runtime overrides are partial per group and merge field-wise onto these values.
export const JOB_GROUP_DEFAULTS: Record<JobGroup, JobGroupConfig> = {
  [JobGroup.ACCOUNT_MERGE]: {
    // Sync merge p95 is ~16.4s today; 60s leaves roughly 3.5× headroom.
    maxWaitSeconds: 5,
    maxRunSeconds: 60,
    maxAttempts: 3,
    // Merge output carries an account identifier. The generic status endpoint must not expose
    // result data for this group — only the domain endpoint may. Fail-closed: new groups set this deliberately.
    exposeResult: false,
  },
};

// The single place mapping a job group to the Process that gates it, so drain() and the cron
// wrapper both check the same kill-switch flag instead of the mapping being duplicated or drifting.
export const JOB_GROUP_PROCESS: Record<JobGroup, Process> = {
  [JobGroup.ACCOUNT_MERGE]: Process.JOB_ACCOUNT_MERGE,
};
