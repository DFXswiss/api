import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScryptOrderInfo,
  ScryptOrderSide,
  ScryptOrderStatus,
  ScryptTransactionStatus,
} from 'src/integration/exchange/dto/scrypt.dto';
import { TradeChangedException } from 'src/integration/exchange/exceptions/trade-changed.exception';
import {
  isVenueRejection,
  ScryptAmendRejectedError,
  ScryptOrderNotFoundError,
  ScryptUnconfirmedWriteError,
} from 'src/integration/exchange/services/scrypt-websocket-connection';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PriceValidity, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem, UncertainOrderResolution } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { OrderOutcomeUnknownException } from '../../exceptions/order-outcome-unknown.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum ScryptAdapterCommands {
  WITHDRAW = 'withdraw',
  SELL = 'sell',
  BUY = 'buy',
}

/** Marks a reference as ours when reading Scrypt's own order/transaction history. */
const SCRYPT_CORRELATION_PREFIX = 'dfx-lm-';

/**
 * How long an acknowledged order may stay unobservable before it is quarantined rather than polled again.
 *
 * Matches the age at which the venue lookup itself gives up on finding an order, so both routes out of a
 * silent order agree. Quarantine is not a verdict — the order is still not declared failed here — it only
 * moves it somewhere a human can act on, or where the caller's own abandon bound eventually gives it up.
 */
const SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES = 60;

@Injectable()
export class ScryptAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(ScryptAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    private readonly scryptService: ScryptService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.SCRYPT);

    this.commands.set(ScryptAdapterCommands.WITHDRAW, this.withdraw.bind(this));
    this.commands.set(ScryptAdapterCommands.SELL, this.sell.bind(this));
    this.commands.set(ScryptAdapterCommands.BUY, this.buy.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case ScryptAdapterCommands.SELL:
        return this.checkSellCompletion(order);

      case ScryptAdapterCommands.BUY:
        return this.checkBuyCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      case ScryptAdapterCommands.SELL:
      case ScryptAdapterCommands.BUY:
        return this.validateTradeParams(params);

      default:
        throw new Error(`Command ${command} not supported by ScryptAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, asset } = this.parseWithdrawParams(order.action.paramMap);

    const token = asset ?? order.pipeline.rule.targetAsset.dexName;

    const balance = await this.scryptService.getAvailableBalance(token);
    if (order.minAmount > balance) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${token} (balance: ${balance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(Math.min(order.maxAmount, balance), 6);

    order.inputAmount = amount;
    order.inputAsset = token;
    order.outputAsset = token;

    try {
      const response = await this.scryptService.withdrawFunds(token, amount, address, undefined, order.correlationId);

      return response.id;
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(
          `${e.message} (balance: ${balance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
        );
      }

      throw this.classifySendOutcome(e, `withdrawal of ${amount} ${token} to ${address}`);
    }
  }

  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset, maxPriceDeviation } = this.parseTradeParams(order.action.paramMap);

    // Structural guard: Scrypt BTC/EUR (and other Scrypt BTC pairs) have materially worse spreads
    // than Scrypt USDT pairs. BTC acquisition on Scrypt is no longer supported — route via Binance USDT.
    if (tradeAsset === 'BTC') {
      throw new OrderNotProcessableException(
        'Scrypt: buying BTC is no longer supported (tradeAsset=BTC). Route via Binance USDT instead.',
      );
    }

    const targetAsset = order.pipeline.rule.targetAsset;
    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`Scrypt/${tradeAsset}`);

    await this.getAndCheckTradePrice(targetAsset, tradeAssetEntity, maxPriceDeviation);

    const availableBalance = await this.scryptService.getAvailableBalance(targetAsset.dexName);
    const effectiveMax = Math.min(order.maxAmount, availableBalance);

    if (effectiveMax < order.minAmount) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${targetAsset.dexName} (balance: ${availableBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(effectiveMax, 6);

    return this.executeSell(order, amount, targetAsset.dexName, tradeAsset);
  }

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset, maxPriceDeviation } = this.parseTradeParams(order.action.paramMap);

    const targetAssetEntity = order.pipeline.rule.targetAsset;

    // Structural guard: Scrypt BTC pairs have materially worse spreads than USDT pairs.
    // BTC acquisition on Scrypt is no longer supported — route via Binance USDT instead.
    if (targetAssetEntity.dexName === 'BTC') {
      throw new OrderNotProcessableException(
        'Scrypt: buying BTC is no longer supported (targetAsset=BTC). Route via Binance USDT instead.',
      );
    }

    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`Scrypt/${tradeAsset}`);

    const price = await this.getAndCheckTradePrice(tradeAssetEntity, targetAssetEntity, maxPriceDeviation);
    const minSellAmount = Util.floor(order.minAmount * price, 6);
    const maxSellAmount = Util.floor(order.maxAmount * price, 6);

    const availableBalance = await this.getAvailableTradeBalance(tradeAsset, targetAssetEntity.dexName);
    const fiatOrderCap = ['CHF', 'EUR'].includes(tradeAsset) ? 200_000 : Infinity;
    const effectiveMax = Math.min(maxSellAmount, availableBalance, fiatOrderCap);

    if (effectiveMax < minSellAmount) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${tradeAsset} (balance: ${availableBalance}, min. requested: ${minSellAmount}, max. requested: ${maxSellAmount})`,
      );
    }

    const amount = Util.floor(effectiveMax, 6);

    order.inputAmount = amount;
    order.inputAsset = tradeAsset;
    order.outputAsset = targetAssetEntity.dexName;

    try {
      return await this.scryptService.sell(tradeAsset, targetAssetEntity.dexName, amount, order.correlationId);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(
          `${e.message} (balance: ${availableBalance}, min. requested: ${minSellAmount}, max. requested: ${maxSellAmount})`,
        );
      }

      throw this.classifySendOutcome(e, `sell of ${amount} ${tradeAsset} to ${targetAssetEntity.dexName}`);
    }
  }

  // --- COMPLETION CHECKS --- //

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { correlationId } = order;

    const withdrawal = await this.scryptService.getWithdrawalStatus(correlationId);

    if (withdrawal && [ScryptTransactionStatus.FAILED, ScryptTransactionStatus.REJECTED].includes(withdrawal.status)) {
      const rejectMessage = withdrawal.rejectReason
        ? `${withdrawal.rejectReason} (${withdrawal.rejectText})`
        : 'unknown reason';
      throw new OrderFailedException(
        `Withdrawal ${correlationId} has failed with status ${withdrawal.status}: ${rejectMessage}`,
      );
    }

    if (!withdrawal?.txHash) {
      // No record at all, past the age at which the venue is considered to have lost it: we cannot tell
      // whether this withdrawal happened, and the manual path only accepts quarantined orders, so leaving it
      // here would mean no way out at all. A record WITHOUT a hash is different — that is an observation, the
      // withdrawal is simply still in flight, and quarantining it would only bounce it back and forth.
      if (!withdrawal && Util.minutesDiff(order.created) > SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES)
        throw new OrderOutcomeUnknownException(
          `Scrypt has no record of withdrawal ${correlationId} after more than ${SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES} minutes`,
        );

      this.logger.verbose(`No withdrawal id for id ${correlationId} at ${this.scryptService.name} found`);
      return false;
    }

    order.outputAmount = withdrawal.amount;

    const { blockchain } = this.parseWithdrawParams(order.action.paramMap);
    return this.dexService.checkTransferCompletion(withdrawal.txHash, blockchain);
  }

  private async checkSellCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);
    const asset = order.pipeline.rule.targetAsset.dexName;

    return this.checkTradeCompletion(order, asset, tradeAsset);
  }

  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);
    const asset = order.pipeline.rule.targetAsset.dexName;

    return this.checkTradeCompletion(order, tradeAsset, asset);
  }

  private async checkTradeCompletion(order: LiquidityManagementOrder, from: string, to: string): Promise<boolean> {
    // Before anything may write again: a previous pass may have had its replacement accepted and then failed
    // to record it, leaving this row pointing at the predecessor the venue has already cancelled. Restarting
    // from that predecessor would place a second order alongside the live replacement.
    if (!(await this.adoptLiveReplacement(order)))
      return this.waitOrQuarantine(order, 'has a claimed replacement that can be neither confirmed nor ruled out');

    // The check may amend or restart the order, which creates a NEW venue order. Hand it a reference derived
    // from the order row so that a replacement whose confirmation never arrives is still findable — without
    // this, the reconciliation below could not cover the amend boundary even in principle.
    const replacementClOrdId = this.nextCorrelationId(order);

    try {
      const isComplete = await this.scryptService.checkTrade(
        order.correlationId,
        from,
        to,
        order.created,
        replacementClOrdId,
        async () => {
          order.recordSpentCorrelationId(replacementClOrdId);
          await this.orderRepo.save(order);
        },
      );

      if (isComplete) {
        order.outputAmount = await this.aggregateTradeOutput(order);
      }

      return isComplete;
    } catch (e) {
      if (e instanceof TradeChangedException) {
        order.updateCorrelationId(e.id);
        await this.orderRepo.save(order);
        return false;
      }

      // Write boundary FIRST. This check can amend or restart the order, and an unconfirmed write must
      // quarantine — before the transient-error branch below, which is only ever safe for reads. Getting the
      // order wrong here would let a dropped socket during an amend look like a harmless retry.
      if (e instanceof ScryptUnconfirmedWriteError) {
        throw new OrderOutcomeUnknownException(
          `${e.message} (replacement reference ${e.reference ?? replacementClOrdId})`,
        );
      }

      // The amend was refused, so nothing was created and the original order is still live. Note the spent
      // reference — the venue will not accept it again — and carry on watching the original.
      if (e instanceof ScryptAmendRejectedError) {
        if (e.spentReference) {
          order.recordSpentCorrelationId(e.spentReference);
          await this.orderRepo.save(order);
        }
        this.logger.warn(`Scrypt refused the amend for order ${order.id}, continuing with the original`);
        return false;
      }

      // The venue once acknowledged this order and now cannot find it. That is not a failure — it may have
      // filled or been cancelled outside our view — so it goes to quarantine instead of releasing the rule,
      // from where a human releases it or the caller's bound eventually gives it up.
      if (e instanceof ScryptOrderNotFoundError) throw new OrderOutcomeUnknownException(e.message);

      // A rejection is a reply: the venue reached a verdict, so the order really did end.
      if (isVenueRejection(e)) throw new OrderFailedException(e.message);

      // Anything else is a failure to OBSERVE an order that the venue has acknowledged and may still be
      // working. Failing it here would let the rule open a second position against the same funds, so the
      // order is kept and looked at again next tick.
      //
      // Hold it back only for a genuine blind spot, though. The failure may just as well have come from
      // pricing or from aggregating the result — on an order the venue can still show us, and parking THAT
      // would have reconciliation hand it straight back, only for the next check to park it again.
      const stillObservable = await this.scryptService.getOrderStatus(order.correlationId).catch(() => null);

      if (!stillObservable) return this.waitOrQuarantine(order, `cannot be observed: ${e.message}`);

      this.logger.warn(`Could not check Scrypt order ${order.id}, will look again next tick: ${e.message}`);
      return false;
    }
  }

  /**
   * Adopt a claimed replacement the venue has accepted but this row never recorded.
   *
   * The window is narrow — the venue accepted the replacement and the save that would have adopted it
   * failed — but its consequence is not: the row still names the predecessor, the venue has cancelled that
   * one, and the next check would happily restart from it while the replacement is live.
   *
   * Only references NEWER than the current one are candidates. A predecessor is not a replacement: after an
   * amend that DID get recorded it sits in the list as cancelled, and adopting it would walk the row
   * backwards and restart the very quantity the replacement is already working.
   *
   * Returns whether this order may be written to at all. A claim that can be neither confirmed nor ruled out
   * is a barrier rather than something to step past — the reference is recorded BEFORE the request leaves,
   * so one the venue does not show may still be live there, and carrying on with the predecessor would put a
   * second request next to it.
   */
  private async adoptLiveReplacement(order: LiquidityManagementOrder): Promise<boolean> {
    const currentAttempt = this.attemptNumber(order, order.correlationId);
    const claimed = this.attemptedReferencesNewestFirst(order).filter(
      (reference) => this.attemptNumber(order, reference) > currentAttempt,
    );

    for (const reference of claimed) {
      // `null` means the venue does not show it, `undefined` that it could not be asked. Neither is a reply,
      // and only a reply can establish that a claimed reference created nothing.
      const info = await this.scryptService.getOrderStatus(reference).catch(() => undefined);

      if (info == null) {
        this.logger.warn(
          `Order ${order.id} claimed ${reference}, but the venue ${
            info === null ? 'does not show it' : 'could not be asked about it'
          } — holding back every write against ${order.correlationId}`,
        );

        return false;
      }

      // A rejection IS a reply: this claim created nothing, so an older one may still be the live order.
      if (info.status === ScryptOrderStatus.REJECTED) continue;

      this.logger.warn(
        `Order ${order.id} still named ${order.correlationId}, but the venue is working ${reference} — adopting it`,
      );
      order.updateCorrelationId(reference);
      await this.orderRepo.save(order);

      return true;
    }

    return true;
  }

  /**
   * Hold an order back because something about it cannot be observed right now.
   *
   * Waiting is the safe answer — writing against an order whose true state is unknown is how a second
   * request against the same funds happens. But not forever: the manual path only accepts quarantined
   * orders, so an order nobody can ever observe would poll for good with no way out at all. Past the same
   * age at which the venue itself is considered to have lost an order, it goes to quarantine instead —
   * still not declared failed here, and from there either released by a human or given up by the caller's
   * own bound.
   */
  private waitOrQuarantine(order: LiquidityManagementOrder, reason: string): boolean {
    if (Util.minutesDiff(order.created) > SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES)
      throw new OrderOutcomeUnknownException(
        `Scrypt order ${order.id} ${reason}, and is over ${SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES} minutes old`,
      );

    this.logger.warn(`Scrypt order ${order.id} ${reason}, will look again next tick`);

    return false;
  }

  /**
   * Every reference this order has actually put on the wire, newest first.
   *
   * Ordered by the attempt suffix rather than by storage order, so it does not depend on how the list was
   * assembled. Deliberately does NOT include the next reference: that one has not been sent, and looking for
   * it would stop the search on an absence that means nothing — leaving the reference that WAS sent
   * unchecked, and the order quarantined until its abandon bound gives up on a request that may well be
   * live.
   */
  private attemptedReferencesNewestFirst(order: LiquidityManagementOrder): CorrelationId[] {
    return [...order.allCorrelationIds].sort((a, b) => this.attemptNumber(order, b) - this.attemptNumber(order, a));
  }

  /** Which attempt a reference belongs to: the reserved one is 0, every replacement counts up from there. */
  private attemptNumber(order: LiquidityManagementOrder, reference: CorrelationId | undefined): number {
    return Number(reference?.slice(`${SCRYPT_CORRELATION_PREFIX}${order.id}-`.length)) || 0;
  }

  /**
   * Reference for the next venue order this row may produce (an amend or a restart).
   *
   * Derived from the order id and the number of references already used, so it is reproducible from the row
   * alone — no extra column, and no window in which a replacement exists that we cannot name.
   */
  private nextCorrelationId(order: LiquidityManagementOrder): CorrelationId {
    return `${SCRYPT_CORRELATION_PREFIX}${order.id}-${order.allCorrelationIds.length}`;
  }

  private async aggregateTradeOutput(order: LiquidityManagementOrder): Promise<number> {
    const correlationIds = order.allCorrelationIds;

    // Fetch all orders in parallel
    const orderResults = await Promise.allSettled(correlationIds.map((id) => this.scryptService.getOrderStatus(id)));

    const orders = orderResults
      .filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof this.scryptService.getOrderStatus>>> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value!);

    // Log failures
    const failures = orderResults.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      this.logger.warn(
        `Order ${order.id}: Failed to fetch ${failures.length} of ${correlationIds.length} orders. ` +
          `Proceeding with ${orders.length} successful fetches.`,
      );
    }

    if (orders.length === 0) {
      throw new OrderFailedException(`Failed to fetch any orders for order ${order.id}`);
    }

    return orders.reduce((sum, o) => sum + this.calculateOrderOutput(o), 0);
  }

  private calculateOrderOutput(order: ScryptOrderInfo): number {
    if (order.filledQuantity <= 0) return 0;

    if (order.side === ScryptOrderSide.BUY) {
      // BUY: output is base currency = filledQuantity
      return order.filledQuantity;
    } else {
      // SELL: output is quote currency = filledQuantity * avgPrice
      return order.avgPrice ? order.filledQuantity * order.avgPrice : order.filledQuantity;
    }
  }

  // --- PARAM VALIDATION --- //

  private validateWithdrawParams(params: Record<string, unknown>): boolean {
    try {
      this.parseWithdrawParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseWithdrawParams(params: Record<string, unknown>): {
    address: string;
    asset?: string;
    blockchain: Blockchain;
  } {
    const address = process.env[params.destinationAddress as string];
    const asset = params.asset as string | undefined;
    const blockchain = params.destinationBlockchain as Blockchain | undefined;

    if (!address || !blockchain) {
      throw new Error(`Params provided to ScryptAdapter.withdraw(...) command are invalid.`);
    }

    return { address, asset, blockchain };
  }

  private validateTradeParams(params: Record<string, unknown>): boolean {
    try {
      this.parseTradeParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseTradeParams(params: Record<string, unknown>): {
    tradeAsset: string;
    maxPriceDeviation?: number;
  } {
    const tradeAsset = params.tradeAsset as string | undefined;
    const maxPriceDeviation = params.maxPriceDeviation as number | undefined;

    if (!tradeAsset) {
      throw new Error(`Params provided to ScryptAdapter trade command are invalid.`);
    }

    return { tradeAsset, maxPriceDeviation };
  }

  // --- HELPER METHODS --- //

  private async executeSell(
    order: LiquidityManagementOrder,
    amount: number,
    fromAsset: string,
    toAsset: string,
  ): Promise<CorrelationId> {
    order.inputAmount = amount;
    order.inputAsset = fromAsset;
    order.outputAsset = toAsset;

    try {
      return await this.scryptService.sell(fromAsset, toAsset, amount, order.correlationId);
    } catch (e) {
      // No "(balance: ..., min. requested: ..., max. requested: ...)" suffix: balance/min/max are not in scope here.
      // The only production Scrypt 'sell' action has no onFail/onSuccess chain, so its error never reaches the liquidity-pipeline regex parser.
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }
      throw this.classifySendOutcome(e, `sell of ${amount} ${fromAsset} to ${toAsset}`);
    }
  }

  /**
   * Venue reference claimed before the request goes out. Scrypt is the one integration that lets us choose
   * it (`ClOrdID`/`ClReqID`), so it is the one integration that can be reconciled after silence.
   *
   * Derived from the order id, which never repeats — this satisfies the venue's "unique daily, below 36
   * characters" requirement without a random component, so the reference is reproducible from the row alone.
   */
  reserveCorrelationId(order: LiquidityManagementOrder): CorrelationId {
    return `${SCRYPT_CORRELATION_PREFIX}${order.id}`;
  }

  /**
   * Decide whether a failed write demonstrably never reached the venue, or whether its outcome is unknown.
   *
   * Fail-closed, like `toBroadcastBoundaryError` in the payout subdomain: only silence-free evidence lets an
   * error stay an ordinary failure. A timeout means the venue may already have executed, so it becomes an
   * unknown outcome and the order is quarantined rather than repeated.
   */
  private classifySendOutcome(e: Error, description: string): Error {
    // Only a reply from the venue proves what happened to the request. A rejection means it was seen and
    // refused — an ordinary failure, safe to let the rule plan again.
    if (isVenueRejection(e)) return e;

    // Everything else is silence, and silence is not evidence. A timeout is obvious, but a dropped socket is
    // just as ambiguous: once `ws.send` has run the bytes may already be on the wire, and the close that
    // follows rejects the pending request with a generic message that says nothing about whether the venue
    // acted on them. Both become unknown outcomes.
    //
    // Over-classifying costs an operator a look at the venue; under-classifying is what moved money without
    // a record. Since absence at the venue is not proof, such an order waits — for a human, or for its
    // abandon bound to run out — rather than resolving itself here, deliberately the expensive direction,
    // because the cheap one is the dangerous one.
    return new OrderOutcomeUnknownException(`Scrypt gave no confirmed outcome for the ${description}: ${e.message}`);
  }

  /**
   * Ask Scrypt what happened to a quarantined order. Observes only — never re-sends.
   *
   * Only a matched reference can confirm a positive. A missing record confirms nothing on its own — Scrypt
   * has no terminal "this reference was never accepted" reply — so it leaves the order quarantined. Both
   * outcomes are eventually given up by the caller, only on different clocks: a complete answer (UNRESOLVED)
   * once the request can no longer be live, an incomplete one (UNAVAILABLE: nothing to ask with, an
   * unreachable venue, or a reference left unasked) after far longer, since only time stands behind it.
   * Nothing here ends in a permanent wait for an operator. An explicit rejection of every attempted
   * reference is the one negative that does settle, and returns NOT_SENT.
   */
  async resolveUncertainOrder(order: LiquidityManagementOrder): Promise<UncertainOrderResolution> {
    const { correlationId } = order;
    // UNAVAILABLE, not UNRESOLVED: with no reference there is nothing to ask about, so the venue was never
    // asked. UNRESOLVED would mean it answered and had no record — a claim nobody made, and one the caller
    // is entitled to abandon the order on once its bound expires. Only orders predating the reserve-before-
    // send guarantee can reach this, and they resolve on the unanswered bound rather than on a verdict.
    if (!correlationId) return UncertainOrderResolution.UNAVAILABLE;

    let allAttemptsRejected = false;

    try {
      if (order.action.command === ScryptAdapterCommands.WITHDRAW) {
        const withdrawal = await this.scryptService.findWithdrawal(correlationId);
        if (withdrawal) {
          this.logger.info(`Scrypt confirmed reference ${correlationId} exists; order ${order.id} was sent`);
          return UncertainOrderResolution.SENT;
        }
      } else {
        // Newest first. A replacement supersedes the order it replaced, and the replaced one usually still
        // exists at the venue in a cancelled state — checking oldest first would match that, report SENT and
        // leave the live replacement untracked while the completion check polls a superseded reference.
        const candidates = this.attemptedReferencesNewestFirst(order);
        const currentAttempt = this.attemptNumber(order, order.correlationId);
        let rejectedCount = 0;

        // A reference cannot be published before the order that reserved it existed; one day of margin
        // covers venue-side clock skew and late re-publication. Never widen past the previous fixed
        // 30-day window for very old orders.
        const since = new Date(Math.max(Util.daysBefore(30).getTime(), Util.daysBefore(1, order.created).getTime()));

        for (const [index, candidate] of candidates.entries()) {
          const info = await this.scryptService.getOrderStatus(candidate, since);

          // Absent, newest first: an accepted replacement may simply not be visible yet, while the order it
          // replaced still is. Falling through to that predecessor would report SENT on a reference the venue
          // has already superseded and leave the live replacement untracked, so stop here instead.
          if (!info) {
            this.logger.warn(
              `Scrypt does not (yet) know reference ${candidate} for order ${order.id} — keeping it quarantined`,
            );

            // Only references at least as current as the adopted one still matter. Anything older was
            // superseded when that adoption happened, so its absence adds nothing.
            const unasked = candidates
              .slice(index + 1)
              .filter((reference) => this.attemptNumber(order, reference) >= currentAttempt);

            // Nothing left worth asking about: the venue answered about everything that could be live, so
            // this is a complete answer and the caller's bound may act on it.
            if (!unasked.length) return UncertainOrderResolution.UNRESOLVED;

            // Something is still unasked, and the predecessor of an invisible replacement is very often the
            // live one. While that replacement could still surface, stopping here is the safe move and the
            // incomplete answer says so.
            if (Util.minutesDiff(order.updated) <= SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES)
              return UncertainOrderResolution.UNAVAILABLE;

            // Past that age it is not surfacing. Returning here every pass would leave the older reference
            // unasked forever — a lookup that structurally never completes, which no waiting can fix and
            // which no bound may abandon on either: these are GTC orders, so an unchecked predecessor can
            // sit open in the book indefinitely. So treat the invisible replacement as never created and
            // carry on to the reference that may actually be live, which is the only way this order ever
            // gets a real answer.
            this.logger.warn(
              `Scrypt still has no record of ${candidate} for order ${order.id} after ${SCRYPT_UNOBSERVABLE_QUARANTINE_MINUTES} minutes — treating it as never created and checking the reference it replaced`,
            );
            order.recordSpentCorrelationId(candidate);
            continue;
          }

          // A refused replacement never took effect and leaves its predecessor live. This is the only case in
          // which an older reference may be considered.
          if (info.status === ScryptOrderStatus.REJECTED) {
            order.recordSpentCorrelationId(candidate);
            rejectedCount++;
            continue;
          }

          // Track the reference the venue actually knows.
          if (candidate !== order.correlationId) order.updateCorrelationId(candidate);

          this.logger.info(`Scrypt confirmed reference ${candidate} exists; order ${order.id} was sent`);
          return UncertainOrderResolution.SENT;
        }

        allAttemptsRejected = candidates.length > 0 && rejectedCount === candidates.length;
      }

      // Every reference this order put on the wire came back rejected. Nothing was ever created, so unlike
      // mere absence this IS a definitive negative — and leaving it unresolved would query a settled outcome
      // forever while the rule stays blocked.
      if (allAttemptsRejected) {
        this.logger.info(`Scrypt rejected every reference of order ${order.id}; nothing was executed`);
        return UncertainOrderResolution.NOT_SENT;
      }

      // Absence is NOT proof. A snapshot without the reference may simply predate the venue registering it,
      // and Scrypt offers no terminal "this was never accepted" acknowledgement to rely on. Concluding
      // otherwise is what would let the rule reissue a request that later materialises — so this reports
      // only what it saw, and never resolves the order on absence alone.
      //
      // The caller bounds the wait: an order stuck here long enough is abandoned rather than held for an
      // operator who may never come. That bound belongs there, not here — this method's job is to report
      // what the venue said, not to decide how long a rule may stay blocked.
      this.logger.warn(
        `Scrypt still has no record of reference ${correlationId} for order ${order.id} — keeping it quarantined`,
      );
      return UncertainOrderResolution.UNRESOLVED;
    } catch (e) {
      // The lookup travels the same connection that just went silent. An unreachable venue is not evidence
      // of anything — stay in quarantine rather than guess in either direction. Reported as UNAVAILABLE and
      // not UNRESOLVED, because no question was actually put to the venue: the caller uses that difference
      // to decide whether the order still owes a look.
      this.logger.warn(`Could not resolve uncertain Scrypt order ${order.id}: ${e.message}`);
      return UncertainOrderResolution.UNAVAILABLE;
    }
  }

  private isBalanceTooLowError(e: Error): boolean {
    return ['Insufficient funds', 'insufficient balance', 'Insufficient position', 'not enough balance'].some((m) =>
      e.message?.toLowerCase().includes(m.toLowerCase()),
    );
  }

  private async getAvailableTradeBalance(from: string, to: string): Promise<number> {
    const availableBalance = await this.scryptService.getAvailableBalance(from);

    const { side } = await this.scryptService.getTradePair(from, to);
    // Reduce balance by 1% when buying to account for price changes
    return side === ScryptOrderSide.BUY ? availableBalance * 0.99 : availableBalance;
  }

  private async getAndCheckTradePrice(from: Asset, to: Asset, maxPriceDeviation = 0.05): Promise<number> {
    const price = await this.scryptService.getCurrentPrice(from.name, to.name);

    const checkPrice = await this.pricingService.getPrice(from, to, PriceValidity.VALID_ONLY);

    if (Math.abs((price - checkPrice.price) / checkPrice.price) > maxPriceDeviation) {
      throw new OrderFailedException(
        `Trade price out of range: exchange price ${price}, check price ${checkPrice.price}, max deviation ${maxPriceDeviation}`,
      );
    }

    return price;
  }
}
