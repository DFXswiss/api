import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

/**
 * Caches the Fiat Republic payee created for one (end user, IBAN, name) triple, mirroring what
 * `OlkyRecipient` does for the Olkypay rail. Fiat Republic payees are long-lived objects and
 * creating a duplicate for every payout would both waste the rate limit and clutter the member
 * dashboard, so a payee is created once and reused.
 *
 * The triple — not the IBAN alone — is the key: Fiat Republic validates the account holder name
 * against the IBAN (Verification of Payee), so a payout to the same IBAN under a different name is
 * a different payee and must not silently reuse the existing one.
 */
@Entity()
@Index('fiatRepublicPayeeIdentity', (p: FiatRepublicPayee) => [p.endUserId, p.iban, p.name], { unique: true })
export class FiatRepublicPayee extends IEntity {
  /** Fiat Republic end user (`eus_…`) the payee belongs to. */
  @Column({ length: 256 })
  endUserId: string;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256 })
  name: string;

  /** Fiat Republic payee id (`pye_…`); null while the create is still in flight. */
  @Column({ length: 256, nullable: true })
  payeeId: string;

  @Column({ length: 256, nullable: true })
  status: string;
}
