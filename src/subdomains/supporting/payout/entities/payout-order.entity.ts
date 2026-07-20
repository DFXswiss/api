import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

export enum PayoutOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT_RETURN = 'BuyFiatReturn',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  MANUAL = 'Manual',
  REF_PAYOUT = 'RefPayout',
}

export enum PayoutOrderStatus {
  CREATED = 'Created',
  PREPARATION_PENDING = 'PreparationPending',
  PREPARATION_CONFIRMED = 'PreparationConfirmed',
  PAYOUT_DESIGNATED = 'PayoutDesignated',
  PAYOUT_UNCERTAIN = 'PayoutUncertain',
  PAYOUT_PENDING = 'PayoutPending',
  COMPLETE = 'Complete',
}

@Entity()
@Index((p: PayoutOrder) => [p.context, p.correlationId], { unique: true })
export class PayoutOrder extends IEntity {
  @Column({ length: 256 })
  context: PayoutOrderContext;

  @Column({ length: 256 })
  correlationId: string;

  @Column({ length: 256 })
  chain: Blockchain;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset?: Asset;

  @Column({ type: 'float' })
  amount: number;

  // §2.3 native-first exactness (issue #4287 stage 1): the EXACT integer base units (wei/satoshi) of the payout
  // `amount`. Nullable + additive — a payout with no captured exact integer stays null and the ledger falls back to
  // the ≤8-dp float derivation (fail-open). numeric ↔ JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  amountBaseUnits?: bigint | null;

  @Column({ length: 256 })
  destinationAddress: string;

  @Column({ length: 256 })
  status: PayoutOrderStatus;

  @Column({ length: 256, nullable: true })
  transferTxId?: string;

  @Column({ length: 256, nullable: true })
  payoutTxId?: string;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  preparationFeeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  preparationFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  preparationFeeAmountChf?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  payoutFeeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  payoutFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  payoutFeeAmountChf?: number;

  // §2.3 native-first exactness (issue #4287 stage 3): the EXACT integer wei of the on-chain gas fee (payoutFeeAmount),
  // captured from the tx receipt; booked verbatim on the network-fee leg. Nullable + additive — a payout with no
  // captured exact fee stays null and the ledger derives from the float (fail-open). numeric <-> bigint via transformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  payoutFeeAmountBaseUnits?: bigint | null;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ length: 2048, nullable: true })
  lastError?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptDate?: Date;

  // Append-only history of tx hashes released for a protected retry (expired/OOG). The release
  // nulls payoutTxId so the order can re-enter the designation flow - without this record the
  // replaced hash would not be reconstructable from the DB, and it is the primary evidence when
  // investigating whether a vanished tx confirmed after all. Known limit: a stale full-entity
  // save from an overlapping cron run (pre-existing write channel) can overwrite this column
  // like any other field; the conditional release itself is pinned and cannot lose entries.
  @Column({ length: 2048, nullable: true })
  releasedPayoutTxIds?: string;

  pendingPreparation(transferTxId: string): this {
    this.transferTxId = transferTxId;
    this.status = PayoutOrderStatus.PREPARATION_PENDING;

    return this;
  }

  preparationConfirmed(): this {
    this.status = PayoutOrderStatus.PREPARATION_CONFIRMED;

    return this;
  }

  recordPreparationFee(
    preparationFeeAsset: Asset,
    preparationFeeAmount: number,
    preparationFeeAmountChf: number,
  ): this {
    this.preparationFeeAsset = preparationFeeAsset;
    this.preparationFeeAmount = preparationFeeAmount;
    this.preparationFeeAmountChf = preparationFeeAmountChf;

    return this;
  }

  designatePayout(): this {
    this.status = PayoutOrderStatus.PAYOUT_DESIGNATED;

    return this;
  }

  rollbackPayoutDesignation(): this {
    this.preparationConfirmed();

    return this;
  }

  pendingPayout(payoutTxId: string) {
    if (!payoutTxId) throw new Error('No payoutTxId provided to PayoutOrder #pendingPayout(...)');

    this.payoutTxId = payoutTxId;
    this.status = PayoutOrderStatus.PAYOUT_PENDING;

    return this;
  }

  rollbackPayout(): this {
    this.payoutTxId = null;
    this.status = PayoutOrderStatus.PREPARATION_CONFIRMED;

    return this;
  }

  recordPayoutFee(payoutFeeAsset: Asset, payoutFeeAmount: number, payoutFeeAmountChf: number): this {
    this.payoutFeeAsset = payoutFeeAsset;
    this.payoutFeeAmount = payoutFeeAmount;
    this.payoutFeeAmountChf = payoutFeeAmountChf;

    return this;
  }

  complete(): this {
    this.status = PayoutOrderStatus.COMPLETE;

    return this;
  }

  recordPayoutFailure(message: string): this {
    this.retryCount = (this.retryCount ?? 0) + 1;
    this.lastError = message?.substring(0, 2048);
    this.lastAttemptDate = new Date();

    return this;
  }

  resetPayoutRetry(): this {
    this.retryCount = 0;
    this.lastError = null;
    this.lastAttemptDate = null;

    return this;
  }

  //*** GETTERS ***//

  get payoutFee(): { asset: Asset; amount: number } {
    return {
      asset: this.payoutFeeAsset,
      amount: Util.round(this.payoutFeeAmount + this.preparationFeeAmount, 8),
    };
  }

  get feeAmountChf(): number {
    return this.preparationFeeAmountChf + this.payoutFeeAmountChf;
  }
}
