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
// Keyset index for the per-minute ledger content-change scan (ORDER BY updated, id).
@Index((p: PayoutOrder) => [p.updated, p.id])
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

  // #4673: the id of a payout transaction that has been built and SIGNED but whose relay has not (yet)
  // returned. Monero's wallet can perform those two steps separately, so the id is durable before
  // anything is submitted and a failed relay becomes a lookup instead of a judgement call. `transferTxId`
  // above is deliberately not reused: it means "the transaction that funded the payout wallet", and the
  // two must stay distinguishable at exactly the moment a relay outcome is in question. `payoutTxId`
  // stays empty until a relay has actually returned, so the pair also records which of the two happened.
  @Column({ length: 256, nullable: true })
  signedPayoutTxId?: string;

  // The wallet's tx_metadata blob for the transaction above, and the sole input to `relay_tx` - which
  // re-submits that exact transaction rather than building a competing one over the same inputs. Every
  // recovery path relays this instead of rebuilding, so it is kept until the order completes. Hex, a few
  // kB: hence `text` rather than a bounded varchar, and excluded from the gs/debug column allowlist.
  @Column({ type: 'text', nullable: true })
  signedPayoutTxMetadata?: string;

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

  recordSignedPayoutTx(signedPayoutTxId: string, signedPayoutTxMetadata: string): this {
    if (!signedPayoutTxId || !signedPayoutTxMetadata)
      throw new Error('No signed tx provided to PayoutOrder #recordSignedPayoutTx(...)');

    this.signedPayoutTxId = signedPayoutTxId;
    this.signedPayoutTxMetadata = signedPayoutTxMetadata;

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
    // The metadata blob exists only to re-relay an unresolved payout; a completed one is mined, so drop
    // the multi-kB payload and keep signedPayoutTxId as the forensic record of the pre-relay id.
    this.signedPayoutTxMetadata = null;

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
