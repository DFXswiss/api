import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum RiskRate {
  SANCTIONED = 'Sanctioned',
  NOT_SANCTIONED = 'NotSanctioned',
}

export enum ManualRiskRate {
  RISK_CONFIRMED = 'RiskConfirmed',
  RISK_ACCEPTED = 'RiskAccepted',
  RISK_NOT_MATCHING = 'RiskNotMatching',
}

@Entity()
export class KycLog extends IEntity {
  @Column({ length: 256 })
  eventType: string;

  @Column({ length: 'MAX' })
  result: string;

  @Column({ length: 256 })
  pdfUrl: string;

  @Column({ length: 256 })
  riskRate: RiskRate;

  @Column({ length: 256 })
  manualRiskRate: ManualRiskRate;

  @Column({ length: 'MAX' })
  comment: string;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
