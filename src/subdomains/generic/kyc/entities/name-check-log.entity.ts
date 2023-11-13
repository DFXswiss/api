import { ChildEntity, Column } from 'typeorm';
import { KycLog } from './kyc-log.entity';

export enum RiskRate {
  SANCTIONED = 'Sanctioned',
  NOT_SANCTIONED = 'NotSanctioned',
}

export enum ManualRiskRate {
  RISK_CONFIRMED = 'RiskConfirmed',
  RISK_ACCEPTED = 'RiskAccepted',
  RISK_NOT_MATCHING = 'RiskNotMatching',
}

@ChildEntity()
export class NameCheckLog extends KycLog {
  @Column({ length: 256 })
  riskRate: RiskRate;

  @Column({ length: 256, nullable: true })
  manualRiskRate: ManualRiskRate;

  @Column({ type: 'datetime2', nullable: true })
  manualRateTimestamp: Date;
}
