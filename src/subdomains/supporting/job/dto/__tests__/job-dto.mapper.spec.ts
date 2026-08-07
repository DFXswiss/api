import { Job } from '../../entities/job.entity';
import { JobGroup, JobStatus } from '../../enums';
import { JOB_GROUP_DEFAULTS } from '../../job-group.config';
import { JobDtoMapper } from '../job-dto.mapper';

describe('JobDtoMapper', () => {
  function createJob(partial: Partial<Job> = {}): Job {
    const job = new Job();
    job.id = partial.id ?? 1;
    job.uid = partial.uid ?? 'Jabc';
    job.group = partial.group ?? JobGroup.ACCOUNT_MERGE;
    job.status = partial.status ?? JobStatus.PENDING;
    job.idempotencyKey = partial.idempotencyKey ?? 'key-1';
    job.attempt = partial.attempt ?? 1;
    job.maxAttempts = partial.maxAttempts ?? 3;
    job.input = partial.input ?? JSON.stringify({ masterId: 1 });
    job.created = partial.created ?? new Date('2026-01-01T00:00:00.000Z');
    if (partial.error !== undefined) job.error = partial.error;
    return job;
  }

  const config = JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE];

  it('replaces FAILED internal errors with a uid-referencing public message', () => {
    const job = createJob({
      uid: 'Jfail1',
      status: JobStatus.FAILED,
      error: 'ECONNREFUSED: connection to database refused at 10.0.0.5:5432',
    });

    const dto = JobDtoMapper.mapJob(job, config);

    expect(dto.error).toBeDefined();
    expect(dto.error).not.toContain('ECONNREFUSED');
    expect(dto.error).not.toContain('10.0.0.5');
    expect(dto.error).toContain('Jfail1');
  });

  it('exposes DEAD_LETTER domain errors unchanged', () => {
    const domainError = 'Merge request is expired';
    const job = createJob({
      uid: 'Jdead1',
      status: JobStatus.DEAD_LETTER,
      error: domainError,
    });

    const dto = JobDtoMapper.mapJob(job, config);

    expect(dto.error).toBe(domainError);
  });
});
