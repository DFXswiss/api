import { Column, Entity, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';

// Standalone audit record documenting, per wallet address, whether and when the RealUnit
// registration was confirmed at Aktionariat. Deliberately foreign-key free (only strings are
// stored): the table is written from the public confirm-aktionariat endpoint and must never
// couple to the production schema of user/kyc tables.
//
// This is a current-state PROJECTION, not the audit trail: one row per wallet, carrying the latest
// attempt (responseStatus/response) plus the confirmedDate latch. The immutable, append-only history of
// every confirmation call lives in the DB `log` table (system Aktionariat / subsystem Confirmation).
// walletAddress is stored lowercased and UNIQUE, so the per-wallet upsert is race-safe (paired with an
// advisory lock) and the authenticated read-back can exact-match it against the lowercased registration.
@Entity()
export class RealUnitAddressConfirmation extends IEntity {
  @Column({ length: 256 })
  @Index({ unique: true })
  walletAddress: string; // canonically lowercased on write; UNIQUE for a race-safe upsert + exact read-back

  @Column({ length: 256 })
  email: string;

  @Column({ length: 256 })
  aktionariatUser: string;

  @Column({ length: 256 })
  aktionariatCode: string;

  // Monotonic "confirmed at" latch: set once, on the first 2xx from Aktionariat, and never cleared or
  // regressed afterwards (a later invalid/unavailable attempt updates responseStatus/response but leaves
  // this intact). Stays null until the wallet is confirmed, so the column doubles as the confirmed-at
  // timestamp and the read-back reads it directly.
  @Column({ type: 'timestamp', nullable: true })
  confirmedDate?: Date;

  @Column({ type: 'int', nullable: true })
  responseStatus?: number;

  @Column({ type: 'text', nullable: true })
  response?: string; // JSON string

  // --- JSON GETTERS / SETTERS (canonical DFX pattern, never expose raw string) --- //

  get responseData(): unknown {
    return this.response ? JSON.parse(this.response) : undefined;
  }

  set responseData(data: unknown) {
    this.response = data != null ? JSON.stringify(data) : null;
  }
}
