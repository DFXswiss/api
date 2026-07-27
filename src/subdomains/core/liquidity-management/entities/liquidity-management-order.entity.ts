import { Active } from 'src/shared/models/active';
import { IEntity } from 'src/shared/models/entity';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, Index, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementOrderStatus } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { OrderOutcomeUnknownException } from '../exceptions/order-outcome-unknown.exception';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementPipeline } from './liquidity-management-pipeline.entity';

@Entity()
export class LiquidityManagementOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  status: LiquidityManagementOrderStatus;

  @Column({ type: 'float', nullable: true })
  minAmount?: number;

  @Column({ type: 'float', nullable: true })
  maxAmount: number;

  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  // §2.3 native-first exactness (issue #4287 stage 2): the EXACT integer base units (wei) of the bridged
  // `outputAmount` that arrives on the target chain, in the decimals of the booked target asset. Nullable +
  // additive — only >8-dp EVM bridges capture it; <=8-dp bridges (whose float derivation is already exact),
  // non-EVM bridges and legacy rows stay null and the ledger derives from the float (fail-open). numeric <->
  // JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  outputAmountBaseUnits?: bigint | null;

  @Column({ length: 256, nullable: true })
  outputAsset?: string;

  @Index()
  @ManyToOne(() => LiquidityManagementPipeline, (liquidityPipeline) => liquidityPipeline.buyCryptos, {
    eager: true,
    nullable: false,
  })
  @JoinTable()
  pipeline: LiquidityManagementPipeline;

  @Index()
  @ManyToOne(() => LiquidityManagementAction, { eager: true, nullable: false })
  @JoinTable()
  action: LiquidityManagementAction;

  @Column({ type: 'int', nullable: true })
  previousOrderId?: number;

  /**
   * Set when somebody has released this order as never sent, and cleared once the venue has been asked once
   * more. While it stands, the order STAYS QUARANTINED — the release is accepted but not yet in effect.
   *
   * A judgement that a request never left is the one conclusion nothing here can verify from the outside,
   * and it is made at the same moment reconciliation may be watching the venue confirm that very order. If
   * the release took effect immediately, that order would be terminal — its rule free to plan against funds
   * that are in fact committed — before anything could contradict it. So it waits for one machine answer,
   * which normally arrives on the next pass, seconds later.
   *
   * A marker for work outstanding, NOT a record of when the release was asked for: that goes into the
   * order's reason, which nothing clears. Indexed so that finding these few rows is never a scan.
   */
  @Index()
  @Column({ type: 'timestamp', nullable: true })
  notSentRecheckDue?: Date | null;

  @Column({ type: 'text', nullable: true })
  correlationId?: string;

  @Column({ type: 'text', nullable: true })
  previousCorrelationIds?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  //*** FACTORY ***//

  static create(
    minAmount: number,
    maxAmount: number,
    pipeline: LiquidityManagementPipeline,
    action: LiquidityManagementAction,
    previousOrderId: number,
  ): LiquidityManagementOrder {
    const order = new LiquidityManagementOrder();

    order.status = LiquidityManagementOrderStatus.CREATED;
    order.minAmount = minAmount;
    order.maxAmount = maxAmount;
    order.pipeline = pipeline;
    order.action = action;
    order.previousOrderId = previousOrderId;

    return order;
  }

  get exchangePrice(): Price {
    const price = this.inputAmount / this.outputAmount;

    return Price.create(
      this.inputAsset,
      this.outputAsset,
      price,
      undefined,
      undefined,
      PriceStep.create(this.action.system, this.inputAsset, this.outputAsset, price),
    );
  }

  get target(): Active {
    return this.pipeline.rule.targetAsset ?? this.pipeline.rule.targetFiat;
  }

  //*** PUBLIC API ***//

  get allCorrelationIds(): string[] {
    const ids = [this.correlationId, this.previousCorrelationIds?.split(',')].flat();
    return [...new Set(ids)].filter((id) => id);
  }

  /**
   * Claim the venue-side reference BEFORE the request goes out, without advancing the status.
   *
   * The order stays CREATED — it has not been sent yet — but the reference is now durable, so an
   * un-acknowledged request can still be looked up afterwards. Without this, an id generated inside the
   * integration and only returned on success is lost exactly when it is needed. Mirrors the reservation
   * that fiat-output performs against Bank Frick before transmitting a payment order.
   */
  reserveCorrelationId(correlationId: string): this {
    this.correlationId = correlationId;

    return this;
  }

  /**
   * Note a reference an attempt has consumed at the venue without adopting it as the current one.
   *
   * A rejected amend still burns its reference — the venue requires them to be unique — so the next attempt
   * must pick a fresh one. Since the next reference is derived from how many this order has used, recording
   * the spent one here is what makes that derivation advance instead of repeating itself.
   */
  recordSpentCorrelationId(spent: string): this {
    if (!this.allCorrelationIds.includes(spent))
      this.previousCorrelationIds = [...this.allCorrelationIds.filter((id) => id !== this.correlationId), spent].join(
        ',',
      );

    return this;
  }

  inProgress(correlationId: string): this {
    this.correlationId = correlationId;
    this.status = LiquidityManagementOrderStatus.IN_PROGRESS;

    return this;
  }

  updateCorrelationId(newCorrelationId: string): this {
    this.previousCorrelationIds = this.allCorrelationIds.join(',');
    this.correlationId = newCorrelationId;

    return this;
  }

  complete(): this {
    this.status = LiquidityManagementOrderStatus.COMPLETE;

    return this;
  }

  notProcessable(error: OrderNotProcessableException): this {
    this.status = LiquidityManagementOrderStatus.NOT_PROCESSABLE;
    this.errorMessage = error.message;

    return this;
  }

  fail(error: OrderFailedException): this {
    this.status = LiquidityManagementOrderStatus.FAILED;
    this.errorMessage = error.message;

    return this;
  }

  /** Quarantine an order whose request left our side without an observed outcome. */
  uncertain(error: OrderOutcomeUnknownException): this {
    this.status = LiquidityManagementOrderStatus.UNCERTAIN;
    this.errorMessage = error.message;

    return this;
  }

  /** The venue confirmed it knows this order: leave quarantine and let the normal completion check take over. */
  resolveAsSent(): this {
    this.status = LiquidityManagementOrderStatus.IN_PROGRESS;
    this.notSentRecheckDue = null;

    return this;
  }

  /** The venue demonstrably never received this order: nothing was executed, so it is a plain failure. */
  resolveAsNotSent(reason: string): this {
    this.status = LiquidityManagementOrderStatus.FAILED;
    this.errorMessage = reason;
    this.notSentRecheckDue = null;

    return this;
  }

  /**
   * Accept somebody's judgement that this order never left — without acting on it yet.
   *
   * The order stays quarantined until the venue has been asked one more time, so a release can never make an
   * order terminal while a confirmation of it is still in flight.
   */
  requestNotSentRelease(reason: string): this {
    this.errorMessage = reason;
    this.notSentRecheckDue = new Date();

    return this;
  }
}
