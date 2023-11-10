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

  @Column({ length: 'MAX', nullable: true })
  result: string;

  @Column({ length: 256, nullable: true })
  pdfUrl: string;

  @Column({ length: 256 })
  riskRate: RiskRate;

  @Column({ length: 256, nullable: true })
  manualRiskRate: ManualRiskRate;

  @Column({ type: 'datetime2', nullable: true })
  manualRateTimestamp: Date;

  @Column({ length: 'MAX', nullable: true })
  comment: string;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
