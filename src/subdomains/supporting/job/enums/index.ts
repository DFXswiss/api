export enum JobStatus {
  PENDING = 'Pending',
  PROCESSING = 'Processing',
  // Successful terminal state.
  COMPLETE = 'Complete',
  // Temporary: failed but attempts remain; waiting for the next run.
  RETRY = 'Retry',
  // Terminal after attempts are exhausted.
  FAILED = 'Failed',
  // Terminal and not retryable (broken input / missing precondition). Kept separate so an
  // unworkable job does not consume attempts yet stays visible.
  DEAD_LETTER = 'DeadLetter',
}

export enum JobGroup {
  ACCOUNT_MERGE = 'AccountMerge',
}

export enum JobPhase {
  WAIT = 'Wait',
  RUN = 'Run',
}

export enum JobAttemptOutcome {
  COMPLETE = 'Complete',
  FAILED = 'Failed',
  DEAD_LETTER = 'DeadLetter',
}
