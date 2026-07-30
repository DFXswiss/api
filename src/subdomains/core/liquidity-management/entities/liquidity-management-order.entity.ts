import { Active } from 'src/shared/models/active';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Price, PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Column, Entity, Index, JoinTable, ManyToOne } from 'typeorm';
import { LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { OrderOutcomeUnknownException } from '../exceptions/order-outcome-unknown.exception';
import { LiquidityManagementAction } from './liquidity-management-action.entity';
import { LiquidityManagementPipeline } from './liquidity-management-pipeline.entity';

/**
 * How long a release waits for a venue that cannot be reached before taking effect anyway.
 *
 * A liveness bound, not a safety one. Nothing is concluded from the silence: the person who released the
 * order concluded it, and this only stops an unreachable venue from vetoing them forever.
 */
const RELEASE_WITHOUT_VENUE_MINUTES = 60;

/**
 * How long a quarantined order may go unaccounted for before it is abandoned instead of held further.
 *
 * The quarantine was built to wait for an operator, on the reasoning that absence at the venue is not proof
 * of non-execution. That reasoning is sound but incomplete: it assumed the wait ends. Where nobody checks a
 * venue by hand, it does not — the order stays UNCERTAIN forever and takes its rule with it, so the venue
 * stops being served at all. A liquidity rule that never runs again is the larger failure, and it is certain,
 * while the double execution being guarded against is merely possible.
 *
 * What carries abandoning is not a conclusion about the order but two things outside it: the venue has
 * confirmed that none of its references can execute any more, and a rule replans from the venue's balance
 * rather than from the abandoned order. An order that did execute has already moved that balance, so the
 * replan sizes itself against what is actually left. That balance is pushed rather than polled, so a fill
 * that has only just landed may briefly not be in it — see the adapter's cancellation for that window.
 *
 * That argument is only as good as the balance behind it, which is why abandoning is confined to orders an
 * integration can actually ask the venue about — in practice an exchange, read live at plan time. It is
 * deliberately NOT extended to orders no integration can look up: a chain balance omits transactions that
 * are sent but unconfirmed, and a bank balance is carried over from the last imported batch, so for those
 * the replan could well be sizing itself against a balance the execution has not reached yet.
 *
 * Within an askable venue, though, every outcome is bounded — including the ones where the answer never
 * arrived. Leaving those to an operator sounds like the careful choice, but where nobody performs the
 * manual release it is not caution, it is a rule that never runs again.
 *
 * Each bound has to outlast the window in which its order could still be in flight, and that window differs
 * by an order of magnitude between kinds of request, so a single value would be either useless or unsafe.
 * The two answered bounds are anchored on what completed Scrypt orders actually took over the 30 days to
 * 2026-07-29, measured in prod:
 *
 *   trades (n=55):      median 9.6s   p95 19.8s   max 57.1s
 *   withdrawals (n=49): median 7.7min p95 82min   max 5.6h
 *
 * Read those as a floor, not a ceiling: they describe orders that finished, so one that never becomes
 * observable at all is by construction absent from them. Which is why nothing is concluded from the clock
 * alone — it only decides when cleaning up is worth attempting. What makes giving up safe is the venue
 * confirming that none of the order's references can still execute.
 *
 * Balances refresh every minute and the pipeline runs every 10 seconds, so no bound is limited by how
 * quickly an abandonment can be noticed — only by how long the request itself may still be alive.
 */
const ABANDON_UNCERTAIN_MINUTES = {
  /**
   * Settled inside the venue, no network leg. Five minutes is roughly five times the slowest such order
   * observed, which leaves room for a market phase that keeps one open longer than anything on record.
   */
  TRADE: 5,
  /**
   * Everything else: transfers, withdrawals, bridges, mints. Twice the slowest withdrawal observed, because
   * the tail here is genuinely long — a bound near the median would reach orders that are simply still
   * running, and reissuing those is what actually moves funds twice.
   *
   * Note what this bound does NOT currently reach: reaching it only triggers a cancellation attempt, and
   * the one venue that implements cancellation refuses it for withdrawals outright — there is no such thing
   * as cancelling one there. So a Scrypt withdrawal still waits for a person, and this value governs the
   * other transfer kinds and any venue that gains a cancellable withdrawal later.
   */
  TRANSFER: 12 * 60,
};

/**
 * Actions that settle inside a venue rather than moving funds across one, as `system/command` pairs.
 *
 * Keyed on both halves, because the command name alone does not say what an action does: `sell` on an
 * exchange is matched off against a book in seconds, while `sell` on the DEX adapter is an on-chain swap
 * with a confirmation time. Matching the name alone would hand the short bound to exactly the actions that
 * least deserve it.
 *
 * An allowlist, not a denylist: anything unrecognised — a new adapter, a renamed command — gets the long
 * bound. Being slow to abandon costs a rule some minutes; being fast to abandon a transfer that is still in
 * flight is what duplicates it.
 *
 * The system half comes from the enum so a rename cannot silently detach the list from reality. The command
 * half stays literal: those enums live in the adapters, which import this entity, and importing them back
 * would close a cycle.
 */
const VENUE_INTERNAL_ACTIONS = [
  `${LiquidityManagementSystem.SCRYPT}/buy`.toLowerCase(),
  `${LiquidityManagementSystem.SCRYPT}/sell`.toLowerCase(),
];

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
   * Two exceptions, both about liveness rather than safety, and neither concluding anything from silence:
   * an order no integration can look up any more never gets an answer, and a venue that has been unreachable
   * for `RELEASE_WITHOUT_VENUE_MINUTES` is not going to give one. There the release takes effect on the
   * operator's assertion — which is what it was checked for. Silence stops being a veto; it never becomes
   * evidence.
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
   * Whether a pending release has waited out a venue that answers nothing.
   *
   * The wait exists to catch a confirmation that is in flight right now. After this long there is none in
   * flight, only an operator who checked and is being ignored — so silence stops vetoing them.
   */
  releaseWaitedOutVenue(): boolean {
    return this.notSentRecheckDue != null && Util.minutesDiff(this.notSentRecheckDue) > RELEASE_WITHOUT_VENUE_MINUTES;
  }

  /**
   * Whether an unresolved order is old enough that cleaning it up is worth attempting.
   *
   * Gates both inconclusive outcomes — a venue that answers and has no record, and one that could not be
   * asked — because neither improves with waiting. Not a safety judgement on its own: what follows is a
   * cancellation, and only the venue confirming that nothing can execute makes giving up safe. See
   * {@link ABANDON_UNCERTAIN_MINUTES}.
   */
  unresolvableTooLong(): boolean {
    // Measured from `updated`, not `created`: an order can run normally for a long time and only become
    // UNCERTAIN late, when a completion check amends or restarts it and that write goes unconfirmed. Its
    // `created` is then already old, so a bound read from it would expire on the very first pass while the
    // fresh replacement request is seconds old and plausibly still arriving — the exact double-send this
    // guards against. `updated` moves with the transition into quarantine, so the clock starts there.
    //
    // Without a timestamp there is no clock to run out. Guarded explicitly because Util.minutesDiff treats a
    // missing date as the epoch and would report tens of millions of minutes — abandoning instantly every
    // order whose `updated` was not loaded. Absent evidence this must hold the order, never drop it.
    if (!this.updated) return false;

    // `>=`, so that reaching the bound is enough. With `>`, the instant the bound is exactly met left the two
    // halves of this clock disagreeing: {@link getAbandonableAt} already reported nothing left — which is
    // what lets the reconciliation pass run at that moment — while this said not yet. The pass then re-stamped
    // its cooldown and the order waited out another full interval, so a five-minute bound gave up at six.
    return Util.minutesDiff(this.updated) >= this.abandonBoundMinutes();
  }

  /**
   * The moment this order becomes abandonable — null while it never does.
   *
   * The same bound and the same clock as {@link unresolvableTooLong}, stated as an absolute instant so that a
   * caller deciding *when to look at this order again* can keep its own wait on the near side of it. A pass
   * throttled past this point would push the abandonment beyond the ceiling that bound exists to impose, and
   * nothing in the throttle itself would reveal that it had.
   *
   * Absolute rather than "time remaining" on purpose. A remaining duration has to be clamped at zero, and that
   * clamp erases the one fact a throttle needs after the deadline: whether the wait it is about to impose
   * started before it. Measured against a fixed instant the question does not arise — and the caller can ask
   * about any moment, not only about now.
   *
   * Null without a timestamp, mirroring that method's refusal to run a clock it does not have: no deadline to
   * respect means no constraint to impose on a caller's wait.
   */
  getAbandonableAt(): Date | null {
    if (!this.updated) return null;

    return new Date(this.updated.getTime() + this.abandonBoundMinutes() * 60_000);
  }

  /**
   * The quarantine bound that applies to this order's action, in minutes. Deliberately the single place that
   * reads {@link ABANDON_UNCERTAIN_MINUTES}: the deadline and the remaining time to it must never be able to
   * disagree about which bound they are talking about.
   */
  private abandonBoundMinutes(): number {
    // Unknown, unloaded or unlisted action falls to the long bound, for the same reason as a missing date.
    const action = `${this.action?.system}/${this.action?.command}`.toLowerCase();

    return VENUE_INTERNAL_ACTIONS.includes(action)
      ? ABANDON_UNCERTAIN_MINUTES.TRADE
      : ABANDON_UNCERTAIN_MINUTES.TRANSFER;
  }

  /**
   * End a quarantined order that has nothing left outstanding at the venue, and let the rule move on.
   *
   * FAILED rather than a verified non-execution: nothing here establishes that the request never took
   * effect — a reference may well have executed — and the reason says so, so the record does not claim more
   * than was actually observed. Named for the state it ends rather than for what ended it, because several
   * routes arrive here.
   */
  abandonUncertain(reason: string): this {
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
