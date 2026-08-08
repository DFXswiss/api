import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

export enum FiatRepublicEndUserState {
  /** Claimed locally, no Fiat Republic call made yet. */
  PENDING = 'Pending',
  /** A create call is (or was) in flight — never issue a second POST from this state. */
  IN_FLIGHT = 'InFlight',
  /** `endUserId` is set and usable. */
  COMPLETED = 'Completed',
  /** Create and recovery both failed, or Fiat Republic rejected the user. Fail closed. */
  FAILED = 'Failed',
}

/**
 * Maps a DFX customer (`userDataId`) to their Fiat Republic end user. Fiat Republic requires an end
 * user object before any virtual account (named sub-account) can be created for that customer, so
 * this row is the claim that makes end-user creation exactly-once across processes: the unique
 * index on `userDataId` is what a second concurrent request loses on, and the state machine is what
 * stops a retry from issuing a second POST after an ambiguous failure.
 *
 * No personal data is stored here — it is only ever sent to Fiat Republic, never duplicated locally.
 */
@Entity()
@Index((e: FiatRepublicEndUser) => [e.userDataId], { unique: true })
export class FiatRepublicEndUser extends IEntity {
  @Column({ type: 'int' })
  userDataId: number;

  /** Fiat Republic's end user id (`eus_…`); null until a create call succeeded. */
  @Column({ length: 256, nullable: true })
  endUserId: string;

  @Column({ length: 256, default: FiatRepublicEndUserState.PENDING })
  state: FiatRepublicEndUserState;

  /** Fixed classification only — never raw upstream text, which echoes personal data back. */
  @Column({ length: 256, nullable: true })
  error: string;

  // --- ENTITY METHODS --- //

  get isUsable(): boolean {
    return this.state === FiatRepublicEndUserState.COMPLETED && !!this.endUserId;
  }
}
