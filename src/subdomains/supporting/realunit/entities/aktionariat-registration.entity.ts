import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { RealUnitAktionariatConfirmationStatus } from '../dto/realunit-confirm-aktionariat.dto';
import { AktionariatRegistrationDto } from '../dto/realunit-registration.dto';

// Queryable, per-wallet record of a RealUnit user's Aktionariat share-register registration. One row
// per wallet (FK on User), replacing the opaque JSON blob previously carried on the generic
// kyc_step.result. The partial unique index guarantees a single ACTIVE registration per wallet-user
// while still allowing historical (deactivated) rows.
@Entity()
@Index((r: AktionariatRegistration) => [r.user], { unique: true, where: '"active" = true' })
export class AktionariatRegistration extends IEntity {
  @Index()
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Index()
  @Column({ length: 256 })
  walletAddress: string; // exact registered address; public confirm lookup without a join

  @Column({ length: 256 })
  email: string; // registration/confirm link (already lowercase-enforced in the DTO)

  @Column({ length: 256 })
  registrationDate: string; // signed, yyyy-mm-dd

  @Column({ type: 'text' })
  signature: string; // EIP-712 signature

  @Column({ type: 'text', nullable: true })
  signedPayload?: string; // exact payload sent to Aktionariat (for an idempotent re-forward)

  @Column({ length: 256, nullable: true })
  aktionariatUserId?: string; // Aktionariat reference; not yet populated in phase 1

  @Column({ type: 'timestamp', nullable: true })
  forwardedToAktionariatDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  confirmedDate?: Date; // buy-gate signal (phase 3+); stays null in phase 1

  @Column({ length: 256, nullable: true })
  confirmationStatus?: RealUnitAktionariatConfirmationStatus;

  @Column({ default: true })
  active: boolean;

  // --- JSON GETTER / SETTER (canonical DFX pattern, never expose the raw string) --- //

  get signedPayloadData(): AktionariatRegistrationDto | undefined {
    return this.signedPayload ? JSON.parse(this.signedPayload) : undefined;
  }

  set signedPayloadData(data: AktionariatRegistrationDto | undefined) {
    this.signedPayload = data != null ? JSON.stringify(data) : null;
  }
}
