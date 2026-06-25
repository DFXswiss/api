import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

// Append-only record of a user accepting a versioned consent topic for a given
// partner (the DFX-side "partner" is the existing Wallet entity — see
// docs/partner-consent). The latest accepted version of a topic is the highest
// `version` for a (userData, partner, topic) tuple; older rows are kept as the
// legal audit trail of when which version was accepted.
@Entity()
export class PartnerConsent extends IEntity {
  @Index()
  @ManyToOne(() => Wallet, { nullable: false })
  partner: Wallet;

  @Index()
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column({ length: 256 })
  topic: string;

  @Column({ type: 'int' })
  version: number;
}
