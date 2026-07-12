import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { RealUnitLegalAgreement } from '../enums/real-unit-legal-agreement.enum';

// Versioned, append-only record of a user's acceptance of a single RealUnit legal agreement. One row per
// accepted version — the unique index over (userData, agreement, version) keeps the full acceptance history
// and turns a re-acceptance into an insert, never an update. Whether the user has accepted the CURRENT
// version of an agreement is answered by comparing the latest row's version against
// Config.blockchain.realunit.legalVersions, so a version bump requires no migration.
@Entity()
@Index((a: RealUnitLegalAcceptance) => [a.userData, a.agreement, a.version], { unique: true })
export class RealUnitLegalAcceptance extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column({ length: 256 })
  agreement: RealUnitLegalAgreement;

  @Column({ length: 256 })
  version: string; // 'YYYYMMDD'

  @Column({ type: 'timestamp' })
  acceptedDate: Date;

  isVersion(version: string): boolean {
    return this.version === version;
  }
}
