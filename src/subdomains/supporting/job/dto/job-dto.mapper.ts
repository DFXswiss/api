import { Job } from '../entities/job.entity';
import { JobStatus } from '../enums';
import { JobGroupConfig } from '../job-group.config';
import { JobDto } from './job.dto';

export class JobDtoMapper {
  static mapJob(job: Job, config: JobGroupConfig): JobDto {
    // Total time a client may reasonably wait for — queueing time plus run time, not run time alone.
    const expectedSeconds = config.maxWaitSeconds + config.maxRunSeconds;

    // Fail-closed — groups whose result is sensitive only expose it through their own domain-specific endpoint.
    const includeResult = config.exposeResult && job.status === JobStatus.COMPLETE;

    // Dead-letter messages are domain statements about the job (safe for the client). Failed
    // messages are internal diagnostics (DB/provider details) and must not leave the system raw.
    let error: string | undefined;
    if (job.status === JobStatus.DEAD_LETTER && job.error != null) {
      error = job.error;
    } else if (job.status === JobStatus.FAILED) {
      error = `Job ${job.uid} failed, contact support if this persists.`;
    }
    // Any other state deliberately reports no error at all. A job in RETRY carries the raw message
    // of its last attempt, which is internal diagnostics — and the job is not finished, so there is
    // nothing final to tell the client yet.

    const dto: JobDto = {
      uid: job.uid,
      group: job.group,
      status: job.status,
      created: job.created,
      expectedSeconds,
      ...(job.startedAt != null ? { started: job.startedAt } : {}),
      ...(job.finishedAt != null ? { finished: job.finishedAt } : {}),
      ...(includeResult ? { result: job.outputData } : {}),
      ...(error != null ? { error } : {}),
    };

    return Object.assign(new JobDto(), dto);
  }
}
