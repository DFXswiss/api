import { UpdateResult } from 'src/shared/models/entity';
import { ChildEntity, Column, ManyToOne } from 'typeorm';
import { BankData } from '../../user/models/bank-data/bank-data.entity';
import { KycLog } from './kyc-log.entity';

export enum RiskStatus {
  SANCTIONED = 'Sanctioned',
  NOT_SANCTIONED = 'NotSanctioned',
}

export enum ManualRiskRate {
  CONFIRMED = 'Confirmed',
  IGNORED = 'Ignored',
  NOT_MATCHING = 'NotMatching',
}

@ChildEntity()
export class NameCheckLog extends KycLog {
  @Column({ length: 256 })
  riskRate: RiskStatus;

  @Column({ length: 256, nullable: true })
  manualRiskRate: ManualRiskRate;

  @Column({ type: 'datetime2', nullable: true })
  manualRateTimestamp: Date;

  @ManyToOne(() => BankData, { nullable: false })
  bankData: BankData;

  //*** FACTORY METHODS ***//
  setPdfUrl(pdfUrl: string): UpdateResult<NameCheckLog> {
    const update: Partial<NameCheckLog> = {
      pdfUrl,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
