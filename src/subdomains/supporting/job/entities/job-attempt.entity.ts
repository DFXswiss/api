import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { JobAttemptOutcome } from '../enums';
import { Job } from './job.entity';

// Append-only record of a single job attempt. Rows here are never updated after the attempt they describe has
// finished, and never deleted. They are the proof of who claimed which attempt, when, and — if it did not
// succeed — the full error it failed with. The `job` row itself only ever carries the current snapshot; this
// table is where the history that snapshot would otherwise destroy on every retry survives.
//
// The unique index on (job, attempt) guarantees that the same attempt of the same job can never be recorded
// twice, no matter how many times claimNext, finish, abort or recoverStale run against it.
@Entity()
@Index((a: JobAttempt) => [a.job, a.attempt], { unique: true })
export class JobAttempt extends IEntity {
  @ManyToOne(() => Job, { nullable: false })
  job: Job;

  @Column({ type: 'int' })
  attempt: number;

  @Column({ length: 256 })
  claimedBy: string;

  @Column({ type: 'timestamp' })
  claimedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date;

  @Column({ length: 256, nullable: true })
  outcome?: JobAttemptOutcome;

  @Column({ type: 'text', nullable: true })
  error?: string;
}
