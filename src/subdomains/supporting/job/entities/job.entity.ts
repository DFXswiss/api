import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { JobGroup, JobStatus } from '../enums';

@Entity()
@Index((j: Job) => [j.status, j.group, j.id])
@Index((j: Job) => [j.group, j.idempotencyKey], { unique: true })
export class Job extends IEntity {
  @Column({ length: 256, unique: true })
  uid: string;

  @Column({ length: 256 })
  group: JobGroup;

  @Column({ length: 256 })
  status: JobStatus;

  @Column({ length: 256 })
  idempotencyKey: string;

  @Column({ type: 'text' })
  input: string;

  @Column({ type: 'text', nullable: true })
  output?: string;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'int' })
  maxAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt?: Date;

  @Column({ length: 256, nullable: true })
  claimedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  nextAttemptAt?: Date;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ length: 256, nullable: true })
  traceparent?: string;

  @ManyToOne(() => UserData, { nullable: true })
  userData?: UserData;

  // --- JSON accessors (raw columns must not leak into business logic) --- //

  get inputData(): unknown {
    return JSON.parse(this.input);
  }

  set inputData(data: unknown) {
    this.input = JSON.stringify(data);
  }

  get outputData(): unknown {
    return this.output ? JSON.parse(this.output) : undefined;
  }

  set outputData(data: unknown) {
    this.output = JSON.stringify(data);
  }

  // --- state transitions --- //

  claim(owner: string): UpdateResult<Job> {
    const now = new Date();
    const update: Partial<Job> = {
      status: JobStatus.PROCESSING,
      claimedAt: now,
      claimedBy: owner,
      startedAt: now,
      attempt: this.attempt + 1,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  complete(output: unknown): UpdateResult<Job> {
    this.outputData = output;

    const update: Partial<Job> = {
      status: JobStatus.COMPLETE,
      finishedAt: new Date(),
      output: this.output,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  fail(error: string, nextAttemptAt: Date | undefined): UpdateResult<Job> {
    const update: Partial<Job> = nextAttemptAt
      ? { status: JobStatus.RETRY, error, nextAttemptAt }
      : { status: JobStatus.FAILED, error, finishedAt: new Date() };

    Object.assign(this, update);

    return [this.id, update];
  }

  deadLetter(error: string): UpdateResult<Job> {
    const update: Partial<Job> = {
      status: JobStatus.DEAD_LETTER,
      error,
      finishedAt: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isFinished(): boolean {
    return [JobStatus.COMPLETE, JobStatus.FAILED, JobStatus.DEAD_LETTER].includes(this.status);
  }

  get waitSeconds(): number | undefined {
    if (!this.startedAt) return undefined;
    return Util.secondsDiff(this.created, this.startedAt);
  }

  get runSeconds(): number | undefined {
    if (!this.finishedAt) return undefined;
    return Util.secondsDiff(this.startedAt, this.finishedAt);
  }

  // Time the caller experiences — from acceptance of the job until the result.
  get totalSeconds(): number | undefined {
    if (!this.finishedAt) return undefined;
    return Util.secondsDiff(this.created, this.finishedAt);
  }
}
