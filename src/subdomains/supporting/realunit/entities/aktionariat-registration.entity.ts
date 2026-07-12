import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { KycPersonalData } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { AktionariatRegistrationDto } from '../dto/realunit-registration.dto';

// Queryable, per-wallet record of a RealUnit user's Aktionariat share-register registration and the
// single source of truth for the registration business data (it replaces the opaque JSON blob
// previously carried on the generic kyc_step.result — no REALUNIT_REGISTRATION kyc_step is created
// anymore). One row per wallet (FK on User); the partial unique index guarantees a single ACTIVE
// registration per wallet-user while keeping historical (deactivated) rows for supersede/merge.
@Entity()
@Index((r: AktionariatRegistration) => [r.user], { unique: true, where: '"active" = true' })
export class AktionariatRegistration extends IEntity {
  @Index()
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Index()
  @Column({ length: 256 })
  walletAddress: string; // canonically lowercased; exact-match public confirm lookup without a join

  @Index()
  @Column({ length: 256 })
  email: string; // lowercase (DTO-enforced); resolves every wallet registered under an email in the confirm flow

  @Column({ length: 256 })
  registrationDate: string; // signed, yyyy-mm-dd

  @Column({ type: 'text' })
  signature: string; // EIP-712 signature (idempotency compare)

  @Column({ type: 'text', nullable: true })
  signedPayload?: string; // exact AktionariatRegistrationDto sent to Aktionariat (keeps mixed-case wallet for re-forward + EIP-712)

  @Column({ type: 'text', nullable: true })
  kycData?: string; // KycPersonalData JSON — ADD_WALLET pre-fill (toUserDataDto) and re-forward

  // Registration lifecycle. Reuses the KYC ReviewStatus values (identical strings) so it doubles as
  // the state machine the REALUNIT_REGISTRATION kyc_step used to hold: COMPLETED (forwarded to
  // Aktionariat) or MANUAL_REVIEW (forward failed, awaiting an admin re-forward). Backfilled rows keep
  // their originating kyc_step.status verbatim.
  @Column({ length: 256 })
  status: ReviewStatus;

  @Column({ type: 'timestamp', nullable: true })
  forwardedToAktionariatDate?: Date;

  @Column({ default: true })
  active: boolean;

  // Whether this registration is gated on an Aktionariat email confirmation before it counts as confirmed.
  // New registrations default to true (Aktionariat sends the confirmation email on a successful forward);
  // the read-back reports emailConfirmed only once a matching confirmation is recorded. The completion
  // migration grandfathers every pre-existing row to false so historical users are never locked out.
  @Column({ default: true })
  requiresEmailConfirmation: boolean;

  // First-confirmation latch and single source of truth for the customer-facing confirmed state: set on the
  // FIRST Aktionariat 2xx confirm for this wallet and never advanced or regressed afterwards. Drives the
  // authenticated read-back's emailConfirmed (a non-null latch OR a grandfathered requiresEmailConfirmation
  // === false counts as confirmed). Null until the wallet is confirmed. The full, append-only history of
  // every confirm call — including 0-match ones — lives in the DB `log` table (system Aktionariat / subsystem
  // Confirmation), not here.
  @Column({ type: 'timestamp', nullable: true })
  confirmedDate?: Date;

  // --- JSON GETTERS / SETTERS (canonical DFX pattern, never expose the raw string) --- //

  get signedPayloadData(): AktionariatRegistrationDto | undefined {
    return this.signedPayload ? JSON.parse(this.signedPayload) : undefined;
  }

  set signedPayloadData(data: AktionariatRegistrationDto | undefined) {
    this.signedPayload = data != null ? JSON.stringify(data) : null;
  }

  get kycDataObj(): KycPersonalData | undefined {
    return this.kycData ? JSON.parse(this.kycData) : undefined;
  }

  set kycDataObj(data: KycPersonalData | undefined) {
    this.kycData = data != null ? JSON.stringify(data) : null;
  }
}
