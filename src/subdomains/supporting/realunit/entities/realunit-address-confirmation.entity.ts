import { Column, Entity, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';

// Standalone audit record documenting, per wallet address, whether and when the RealUnit
// registration was confirmed at Aktionariat. Deliberately foreign-key free (only strings are
// stored): the table is written from the public confirm-aktionariat endpoint and must never
// couple to the production schema of user/kyc tables.
@Entity()
export class RealUnitAddressConfirmation extends IEntity {
  @Column({ length: 256 })
  @Index()
  walletAddress: string;

  @Column({ length: 256 })
  email: string;

  @Column({ length: 256 })
  aktionariatUser: string;

  @Column({ length: 256 })
  aktionariatCode: string;

  // Set only once Aktionariat confirmed the connection (2xx). Stays null for invalid/unavailable
  // attempts so the column doubles as the "confirmed at" timestamp.
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
