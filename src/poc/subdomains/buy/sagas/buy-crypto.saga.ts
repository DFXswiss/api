import { Injectable } from '@nestjs/common';
import { Saga, ICommand, ofType } from '@nestjs/cqrs';
import { Observable, map, concatMap } from 'rxjs';
import { BankTransactionCompleteEvent } from '../../bank/events/bank-transaction-complete.event';
import { LiquiditySecuredEvent } from '../../exchange/events/liquidity-secured.event';
import { UserNotifiedEvent } from '../../notification/events/user-notified.event';
import { PayoutCompleteEvent } from '../../payout/events/payout-complete.event';
import { PayoutPreparedEvent } from '../../payout/events/payout-prepared.event';
import { DoPayoutCommand } from '../../payout/commands/do-payout.command';
import { NotifyUserCommand } from '../../notification/commands/notify-user.command';
import { PreparePayoutCommand } from '../../payout/commands/prepare-payout.command';
import { SecureLiquidityCommand } from '../../exchange/commands/secure-liquidity.command';
import { GetReferencePricesCommand } from '../../exchange/commands/get-reference-prices.command';
import { PriceReceivedEvent } from '../../exchange/events/price-ready.event';
import { PocSagaRepository } from '../../../shared/saga/repositories/saga.repository';
import { PocBuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { PocSagaLogRepository } from 'src/poc/shared/saga/repositories/saga-log.repository';
import { validateSync } from 'class-validator';
import { PocSaga } from 'src/poc/shared/saga/entities/saga.entity';
import { PocBuyCrypto } from '../models/buy-crypto.entity';
import { IEvent } from 'src/poc/shared/events/event';
import { Util } from 'src/shared/util';

enum BuyCryptoSagaStep {
  BankTransactionEventStart = 'BankTransactionEventStart',
  BankTransactionEventEnd = 'BankTransactionEventEnd',
  PriceReceivedEventStart = 'PriceReceivedEventStart',
  PriceReceivedEventEnd = 'PriceReceivedEventEnd',
  LiquiditySecuredEventStart = 'LiquiditySecuredEventStart',
  LiquiditySecuredEventEnd = 'LiquiditySecuredEventEnd',
  PayoutPreparedEventStart = 'PayoutPreparedEventStart',
  PayoutPreparedEventEnd = 'PayoutPreparedEventEnd',
  PayoutCompleteEventStart = 'PayoutCompleteEventStart',
  PayoutCompleteEventEnd = 'PayoutCompleteEventEnd',
  UserNotifiedEventStart = 'UserNotifiedEventStart',
  UserNotifiedEventEnd = 'UserNotifiedEventEnd',
}

@Injectable()
export class BuyCryptoSaga {
  constructor(
    private readonly sagaRepo: PocSagaRepository,
    private readonly sagaLogRepo: PocSagaLogRepository,
    private readonly buyCryptoRepo: PocBuyCryptoRepository,
  ) {}

  @Saga()
  start(events$: Observable<any>): Observable<ICommand> {
    return events$.pipe(
      ofType(BankTransactionCompleteEvent),
      concatMap(async (event) => this.handleBankTransactionCompleteEvent(event)),
      map(({ correlationId, from, to }) => new GetReferencePricesCommand(correlationId, { from, to })),
    );
  }

  @Saga()
  onReferencePricesReceived(events$: Observable<any>): Observable<ICommand> {
    return events$.pipe(
      ofType(PriceReceivedEvent),
      concatMap(async (event) => this.handlePriceReceivedEvent(event)),
      map(
        ({ correlationId, referenceAsset, referenceAmount, targetAsset }) =>
          new SecureLiquidityCommand(correlationId, { referenceAsset, referenceAmount, targetAsset }),
      ),
    );
  }

  @Saga()
  onLiquiditySecured(events$: Observable<any>): Observable<ICommand> {
    return events$.pipe(
      ofType(LiquiditySecuredEvent),
      concatMap(async (event) => this.handleLiquiditySecuredEvent(event)),
      map(
        ({ correlationId, asset, amount, destination }) =>
          new PreparePayoutCommand(correlationId, { asset, amount, destination }),
      ),
    );
  }

  @Saga()
  onPayoutPrepared(events$: Observable<any>): Observable<ICommand> {
    return events$.pipe(
      ofType(PayoutPreparedEvent),
      concatMap(async (event) => this.handlePayoutPreparedEvent(event)),
      map(
        ({ correlationId, payoutReservationId }) =>
          new DoPayoutCommand(correlationId, { payoutOrderId: payoutReservationId }),
      ),
    );
  }

  @Saga()
  onPayoutComplete(events$: Observable<any>): Observable<ICommand> {
    return events$.pipe(
      ofType(PayoutCompleteEvent),
      concatMap(async (event) => this.handlePayoutCompleteEvent(event)),
      map(({ correlationId, payload }) => new NotifyUserCommand(correlationId, payload)),
    );
  }

  @Saga()
  end(events$: Observable<any>): Observable<any> {
    return events$.pipe(
      ofType(UserNotifiedEvent),
      concatMap(async (event) => this.handleUserNotifiedEvent(event)),
    );
  }

  // *** EVENT HANDLERS *** //

  private async handleBankTransactionCompleteEvent(event: BankTransactionCompleteEvent) {
    const saga = await this.startSaga(event);

    try {
      const buyCrypto = await this.prepareStep<BankTransactionCompleteEvent>(
        event,
        saga,
        BuyCryptoSagaStep.BankTransactionEventStart,
      );

      buyCrypto.defineAssetExchangePair();
      await this.buyCryptoRepo.save(buyCrypto);
      await this.logStep(saga, BuyCryptoSagaStep.BankTransactionEventEnd);

      return {
        correlationId: saga.correlationId,
        from: buyCrypto.inputReferenceAsset,
        to: buyCrypto.outputReferenceAsset,
      };
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.BankTransactionEventEnd, e.message);
      throw e;
    }
  }

  private async handlePriceReceivedEvent(event: PriceReceivedEvent) {
    console.log(`Reference prices received. CorrelationID: ${event.correlationId}`);

    const saga = await this.getSagaByCorrelationId(event.correlationId);

    try {
      const buyCrypto = await this.prepareStep<PriceReceivedEvent>(
        event,
        saga,
        BuyCryptoSagaStep.PriceReceivedEventStart,
      );

      buyCrypto.calculateOutputReferenceAmount(event.payload);
      await this.buyCryptoRepo.save(buyCrypto);
      await this.logStep(saga, BuyCryptoSagaStep.BankTransactionEventEnd);

      return {
        correlationId: saga.correlationId,
        referenceAsset: buyCrypto.outputReferenceAsset,
        referenceAmount: buyCrypto.outputReferenceAmount,
        targetAsset: buyCrypto.outputAsset,
      };
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.PriceReceivedEventEnd, e.message);
      throw e;
    }
  }

  private async handleLiquiditySecuredEvent(event: LiquiditySecuredEvent) {
    console.log(`Liquidity secured. CorrelationID: ${event.correlationId}`);

    const saga = await this.getSagaByCorrelationId(event.correlationId);

    try {
      const buyCrypto = await this.prepareStep<LiquiditySecuredEvent>(
        event,
        saga,
        BuyCryptoSagaStep.LiquiditySecuredEventStart,
      );

      buyCrypto.setOutputAmount(event.payload.securedAmount);
      await this.buyCryptoRepo.save(buyCrypto);
      await this.logStep(saga, BuyCryptoSagaStep.LiquiditySecuredEventEnd);

      return {
        correlationId: saga.correlationId,
        asset: buyCrypto.outputAsset,
        amount: buyCrypto.outputAmount,
        destination: buyCrypto.targetAddress,
      };
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.LiquiditySecuredEventEnd, e.message);
      throw e;
    }
  }

  private async handlePayoutPreparedEvent(event: PayoutPreparedEvent) {
    console.log(`Payout prepared. CorrelationID: ${event.correlationId}`);

    const saga = await this.getSagaByCorrelationId(event.correlationId);

    try {
      await this.prepareStep<PayoutPreparedEvent>(event, saga, BuyCryptoSagaStep.PayoutPreparedEventStart);
      await this.logStep(saga, BuyCryptoSagaStep.PayoutPreparedEventEnd);

      return { correlationId: saga.correlationId, payoutReservationId: event.payload.payoutReservationId };
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.PayoutPreparedEventEnd, e.message);
      throw e;
    }
  }

  private async handlePayoutCompleteEvent(event: PayoutCompleteEvent) {
    console.log(`Payout complete. CorrelationID: ${event.correlationId}`);

    const saga = await this.getSagaByCorrelationId(event.correlationId);

    try {
      const buyCrypto = await this.prepareStep<PayoutCompleteEvent>(
        event,
        saga,
        BuyCryptoSagaStep.PayoutCompleteEventStart,
      );

      buyCrypto.recordTransactionPayout(event.payload.payoutTransactionId);
      await this.logStep(saga, BuyCryptoSagaStep.PayoutCompleteEventEnd);

      return {
        correlationId: saga.correlationId,
        payload: {
          userData: buyCrypto.buy.user.userData,
          translationKey: 'mail.payment.buyCrypto',
          params: {
            buyFiatAmount: buyCrypto.inputAmount,
            buyFiatAsset: buyCrypto.inputAsset,
            buyCryptoAmount: buyCrypto.outputAmount,
            buyCryptoAsset: buyCrypto.outputAsset,
            buyFeePercentage: Util.round(buyCrypto.percentFee * 100, 2),
            exchangeRate: Util.round(buyCrypto.inputAmount / buyCrypto.outputAmount, 2),
            buyWalletAddress: Util.trimBlockchainAddress(buyCrypto.targetAddress),
            buyTxId: buyCrypto.txId,
          },
        },
      };
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.PayoutCompleteEventEnd, e.message);
      throw e;
    }
  }

  private async handleUserNotifiedEvent(event: UserNotifiedEvent): Promise<void> {
    console.log(`Notification sent. CorrelationID: ${event.correlationId}`);

    const saga = await this.getSagaByCorrelationId(event.correlationId);

    try {
      const buyCrypto = await this.prepareStep<UserNotifiedEvent>(
        event,
        saga,
        BuyCryptoSagaStep.UserNotifiedEventStart,
      );

      buyCrypto.confirmSentMail();
      await this.buyCryptoRepo.save(buyCrypto);

      await this.logStep(saga, BuyCryptoSagaStep.UserNotifiedEventEnd);
    } catch (e) {
      await this.logStep(saga, BuyCryptoSagaStep.UserNotifiedEventEnd, e.message);
      throw e;
    }
  }

  // *** HELPER METHODS *** //

  private validateEvent<T extends { payload: any }>(event: T): T {
    const errors = validateSync(event.payload);

    if (errors.length > 0) {
      throw new Error(errors.join());
    }

    return event;
  }

  private async startSaga(event: BankTransactionCompleteEvent) {
    console.log(`Start BuyCrypto Saga. Correlation ID: ${event.correlationId}`);

    const saga = this.sagaRepo.create({
      name: 'BuyCryptoSaga',
      correlationId: event.correlationId,
      subjectId: event.payload.buyCryptoId.toString(),
      logs: [],
    });

    return this.sagaRepo.save(saga);
  }

  private async logStep(saga: PocSaga, step: BuyCryptoSagaStep, error?: string): Promise<void> {
    const log = this.sagaLogRepo.create({ name: step, timestamp: new Date(), saga, success: !error, error });
    const updatedSaga = saga.addLog(log);

    await this.sagaRepo.save(updatedSaga);
  }

  private async getSagaByCorrelationId(correlationId: string): Promise<PocSaga> {
    const saga = await this.sagaRepo.findOne({ where: { correlationId }, relations: ['logs'] });

    if (!saga) {
      throw new Error(`Saga not found! ID: ${correlationId}`);
    }

    return saga;
  }

  private async prepareStep<T extends IEvent>(event: T, saga: PocSaga, step: BuyCryptoSagaStep): Promise<PocBuyCrypto> {
    await this.logStep(saga, step);

    this.validateEvent<T>(event);

    const buyCrypto = await this.buyCryptoRepo.findOne({
      where: { id: saga.subjectId },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

    if (!buyCrypto) {
      const message = `BuyCrypto not found. ID: ${saga.subjectId}`;
      throw new Error(message);
    }

    return buyCrypto;
  }
}
