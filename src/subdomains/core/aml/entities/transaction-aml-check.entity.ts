import { IEntity } from 'src/shared/models/entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AmlReason } from '../enums/aml-reason.enum';
import { CheckStatus } from '../enums/check-status.enum';

export enum AmlSourceType {
  AML_CHECK_CRON = 'AmlCheckCron', // automatic buy-*-preparation doAmlCheck verdict
  MANUAL_UPDATE = 'ManualUpdate', // COMPLIANCE PUT :id
  MANUAL_PASS = 'ManualPass', // PUT :id/amlCheck manual pass
  MANUAL_RESET = 'ManualReset', // DELETE :id/amlCheck manual reset
  PHONE_CALL_RESET = 'PhoneCallReset', // phoneCallCompleted observable reset
  RISK_BLOCK_RESET = 'RiskBlockReset', // batch risk-block reset
  BLOCKED_STOP = 'BlockedStop', // buy-crypto-out stop() for blocked/deleted user
  CHARGEBACK = 'Chargeback', // chargebackFillUp
  FEE_TOO_HIGH = 'FeeTooHigh', // fee / payment-link fee-too-high fail
  TX_ADMIN = 'TxAdmin', // TransactionAdminController direct write
  BACKFILL = 'Backfill', // one-time genesis row for pre-existing open transactions
}

@Entity()
export class TransactionAmlCheck extends IEntity {
  @Column({ length: 256 })
  entityType: string; // 'BuyCrypto' | 'BuyFiat' | 'Transaction'

  @Column({ type: 'integer' })
  entityId: number; // BuyCrypto/BuyFiat/Transaction id (denormalized; survives even if relation nulled)

  @Column({ length: 256 })
  source: AmlSourceType; // which rule/manual action triggered the transition

  @Column({ length: 256, nullable: true })
  previousAmlCheck?: CheckStatus; // OLD value (null when first-ever verdict)

  @Column({ length: 256, nullable: true })
  amlCheck?: CheckStatus; // NEW value (null on reset)

  @Column({ length: 256, nullable: true })
  previousAmlReason?: AmlReason;

  @Column({ length: 256, nullable: true })
  amlReason?: AmlReason;

  @Column({ length: 256, nullable: true })
  amlResponsible?: string; // 'API' or named person (PII-restricted)

  @Column({ type: 'text', nullable: true })
  comment?: string; // joined AmlError names / manual note (PII-restricted)

  @Column({ type: 'timestamp', nullable: true })
  priceDefinitionAllowedDate?: Date;

  @Column({ type: 'boolean', nullable: true })
  highRisk?: boolean;

  @Index()
  @ManyToOne(() => Transaction, (t) => t.amlChecks, { nullable: false })
  @JoinColumn()
  transaction: Transaction;
}
