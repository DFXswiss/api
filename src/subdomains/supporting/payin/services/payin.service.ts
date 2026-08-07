import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { EntityManager, FindOptionsWhere, In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { DepositRoute } from '../../address-pool/route/deposit-route.entity';
import { TransactionSourceType, TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { RetryPayInSendDto } from '../dto/retry-payin-send.dto';
import {
  CryptoInput,
  CryptoInputInFlightSendStatus,
  PayInAction,
  PayInConfirmationType,
  PayInPurpose,
  PayInStatus,
  PayInType,
} from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';
import { PayInRepository } from '../repositories/payin.repository';
import { RegisterStrategyRegistry } from '../strategies/register/impl/base/register.strategy-registry';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { SendStrategyRegistry } from '../strategies/send/impl/base/send.strategy-registry';
import { PayInBitcoinService } from './payin-bitcoin.service';
import { PayInFiroService } from './payin-firo.service';

@Injectable()
export class PayInService {
  private readonly logger = new DfxLogger(PayInService);

  constructor(
    private readonly payInRepository: PayInRepository,
    private readonly registerStrategyRegistry: RegisterStrategyRegistry,
    private readonly sendStrategyRegistry: SendStrategyRegistry,
    private readonly transactionService: TransactionService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly payInBitcoinService: PayInBitcoinService,
    private readonly payInFiroService: PayInFiroService,
    private readonly notificationService: NotificationService,
  ) {}

  // --- PUBLIC API --- //
  async createPayIn(
    senderAddress: string,
    receiverAddress: string,
    asset: Asset,
    txId: string,
    txType: PayInType,
    blockHeight: number,
    amount: number,
  ): Promise<CryptoInput> {
    const [payIn] = await this.createPayIns([
      {
        senderAddresses: senderAddress,
        receiverAddress: BlockchainAddress.create(receiverAddress, asset.blockchain),
        txId,
        txType,
        blockHeight,
        amount,
        asset,
      },
    ]);

    return payIn;
  }

  async pollAddress(address: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    const registerStrategy = this.registerStrategyRegistry.get(address.blockchain);
    if (registerStrategy.pollAddress) return registerStrategy.pollAddress(address, fromBlock, toBlock);

    throw new BadRequestException(`Address poll not supported for ${address.blockchain}`);
  }

  // fail-open string → bigint for the exact base units captured at ingestion (issue #4287 stage 1): a malformed value
  // must never wedge live pay-in creation, so anything not a clean integer string falls back to null and the ledger
  // then derives the base units from the float amount as before.
  private parseBaseUnits(value?: string): bigint | null {
    return value != null && /^-?\d+$/.test(value) ? BigInt(value) : null;
  }

  async createPayIns(transactions: PayInEntry[]): Promise<CryptoInput[]> {
    const payIns: CryptoInput[] = [];

    for (const {
      senderAddresses,
      receiverAddress,
      txId,
      txType,
      txSequence,
      blockHeight,
      amount,
      amountBaseUnits,
      asset,
    } of transactions) {
      const payIn = CryptoInput.create(
        senderAddresses,
        receiverAddress,
        txId,
        txType,
        txSequence,
        blockHeight,
        amount,
        asset,
        this.parseBaseUnits(amountBaseUnits),
      );

      const exists = await this.payInRepository.exists({
        where: {
          inTxId: txId,
          txSequence: txSequence,
          asset: { id: asset?.id },
          address: {
            address: receiverAddress.address,
            blockchain: receiverAddress.blockchain,
          },
        },
      });

      if (!exists) {
        payIn.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.CRYPTO_INPUT });

        if (payIn.isPayment && payIn.status !== PayInStatus.FAILED) await this.fetchPayment(payIn);

        await this.payInRepository.save(payIn);

        // A pay-in without a processable asset is persisted as terminal FAILED with no retry path (see
        // CryptoInput.create): the funds sit on the deposit address with no further processing and no other
        // observer surfaces this, so alert on it here. Scoped to the missing-asset cause only — other FAILED
        // reasons (e.g. a zero amount) are not a stuck-funds condition and stay silent as before.
        if (!asset && payIn.status === PayInStatus.FAILED) await this.alertUnprocessablePayIn(payIn);

        payIns.push(payIn);
      }
    }

    return payIns;
  }

  private async alertUnprocessablePayIn(payIn: CryptoInput): Promise<void> {
    const errorMessage =
      `Pay-in has no processable asset and cannot be forwarded: blockchain ${payIn.address.blockchain}, ` +
      `deposit address ${payIn.address.address}, txId ${payIn.inTxId}, amount ${payIn.amount}`;
    this.logger.error(errorMessage);

    try {
      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Pay-in without processable asset',
          errors: [errorMessage],
          isLiqMail: true,
        },
        correlationId: `|${payIn.inTxId}|`,
        options: { suppressRecurring: true },
      });
    } catch (e) {
      this.logger.error(`Failed to send pay-in-without-asset alert for txId ${payIn.inTxId}:`, e);
    }
  }

  async getCryptoInputsByTransactionIds(transactionIds: number[]): Promise<CryptoInput[]> {
    if (!transactionIds.length) return [];
    return this.payInRepository.find({
      where: { transaction: { id: In(transactionIds) } },
      relations: { transaction: true },
    });
  }

  async getCryptoInputByKeys(keys: string[], value: any): Promise<CryptoInput> {
    const query = this.payInRepository
      .createQueryBuilder('cryptoInput')
      .select('cryptoInput')
      .leftJoinAndSelect('cryptoInput.transaction', 'transaction')
      .leftJoinAndSelect('transaction.userData', 'userData');

    for (const key of keys) {
      query.orWhere(`${key.includes('.') ? key : `cryptoInput.${key}`} = :param`, { param: value });
    }

    return query.getOne();
  }

  private async fetchPayment(payIn: CryptoInput): Promise<void> {
    try {
      payIn.paymentQuote = await this.paymentLinkPaymentService.getPaymentQuoteByCryptoInput(payIn);
      payIn.paymentLinkPayment = payIn.paymentQuote.payment;
    } catch (e) {
      this.logger.error(`Failed to fetch payment for pay-in ${payIn.inTxId}:`, e);
      payIn.status = PayInStatus.FAILED;
    }
  }

  async getNewPayIns(): Promise<CryptoInput[]> {
    return this.payInRepository.find({
      where: [
        { status: PayInStatus.CREATED, txType: IsNull() },
        {
          status: PayInStatus.CREATED,
          txType: Not(In([PayInType.PERMIT_TRANSFER, PayInType.SIGNED_TRANSFER, PayInType.CONFIRMED_DEPOSIT])),
        },
      ],
      relations: { transaction: true, paymentLinkPayment: { link: { route: true } } },
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return this.payInRepository.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: { route: { user: true } },
      order: { id: 'DESC' },
    });
  }

  async getPendingPayIns(): Promise<CryptoInput[]> {
    // SendUncertain can remain unresolved for days and, like Sending, must stay in pending balances.
    return this.payInRepository.findBy({
      status: In([
        PayInStatus.ACKNOWLEDGED,
        PayInStatus.FORWARDED,
        PayInStatus.RETURNED,
        PayInStatus.TO_RETURN,
        PayInStatus.SENDING,
        PayInStatus.SEND_UNCERTAIN,
      ]),
      isConfirmed: true,
      txType: Not(PayInType.PAYMENT),
    });
  }

  async getPayInFee(from: Date): Promise<number> {
    const { fee } = await this.payInRepository
      .createQueryBuilder('cryptoInput')
      .select('SUM(cryptoInput.forwardFeeAmountChf)', 'fee')
      .where('cryptoInput.created >= :from', { from })
      .getRawOne<{ fee: number }>();

    return fee ?? 0;
  }

  async acknowledgePayIn(payInId: number, purpose: PayInPurpose, route: Staking | Sell | Swap): Promise<void> {
    const payIn = await this.payInRepository.findOneBy({ id: payInId });
    const strategy = this.sendStrategyRegistry.getSendStrategy(payIn.asset);

    payIn.acknowledge(purpose, route, strategy.forwardRequired);

    await this.payInRepository.save(payIn);
  }

  async updatePayInAction(payInId: number, amlCheck: CheckStatus): Promise<void> {
    if (![CheckStatus.FAIL, CheckStatus.PASS].includes(amlCheck)) return;

    await this.payInRepository.update(payInId, {
      action: amlCheck === CheckStatus.PASS ? PayInAction.FORWARD : PayInAction.WAITING,
    });
  }

  async returnPayIn(
    payIn: CryptoInput,
    returnAddress: string,
    chargebackAmount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(CryptoInput) ?? this.payInRepository;

    // Decide on the current row, not on the caller's snapshot: the send worker advances
    // status/returnTxId concurrently, and a stale snapshot passing the guards below must not
    // roll that progress back (issue #4739 — reachable second broadcast).
    const current = await repo.findOne({
      where: { id: payIn.id },
      relations: { route: { user: true }, transaction: true },
    });
    if (!current) throw new NotFoundException('CryptoInput not found');

    if (current.action === PayInAction.FORWARD) throw new BadRequestException('CryptoInput already forwarded');
    if (CryptoInputInFlightSendStatus.includes(current.status))
      throw new BadRequestException('CryptoInput send in flight or uncertain');
    if ([PayInStatus.RETURN_CONFIRMED, PayInStatus.RETURNED].includes(current.status) || current.returnTxId)
      throw new BadRequestException('CryptoInput already returned');

    // Built before triggerReturn assigns over the entity, so it pins the state the guards decided on.
    // Re-triggering a genuinely idle TO_RETURN row (no concurrent change) stays allowed — compliance
    // may amend a pending return's address/amount; the claim only rejects rows that changed between
    // read and write.
    const claimWhere: FindOptionsWhere<CryptoInput> = {
      id: current.id,
      status: current.status,
      action: current.action ?? IsNull(),
      returnTxId: IsNull(),
    };
    const [, update] = current.triggerReturn(
      BlockchainAddress.create(returnAddress, current.asset.blockchain),
      chargebackAmount,
    );
    const claim = await repo.update(claimWhere, update);
    if (claim.affected !== 1) throw new ConflictException('CryptoInput state changed concurrently');

    if (current.transaction)
      await this.transactionService.updateInternal(
        current.transaction,
        {
          type: TransactionTypeInternal.CRYPTO_INPUT_RETURN,
          user: current.route.user,
        },
        manager,
      );
  }

  async ignorePayIn(payIn: CryptoInput, purpose: PayInPurpose, route: DepositRoute): Promise<void> {
    const _payIn = await this.payInRepository.findOneBy({ id: payIn.id });

    _payIn.ignore(purpose, route);

    await this.payInRepository.save(_payIn);
  }

  async retryUncertainSend(accountId: number, dto: RetryPayInSendDto): Promise<void> {
    const payIn = await this.payInRepository.findOneBy({ id: dto.id });
    if (!payIn) throw new NotFoundException('CryptoInput not found');

    if (payIn.status !== PayInStatus.SEND_UNCERTAIN)
      throw new BadRequestException(
        `CryptoInput ${dto.id} cannot be retried in status ${payIn.status}, expected ${PayInStatus.SEND_UNCERTAIN}`,
      );

    // A pay-in that already carries an out/return tx id did broadcast — reconcile against the chain, never re-send.
    if (payIn.outTxId || payIn.returnTxId)
      throw new BadRequestException(
        `CryptoInput ${dto.id} has ${
          payIn.outTxId ? `outTxId ${payIn.outTxId}` : `returnTxId ${payIn.returnTxId}`
        } and must be reconciled, not retried`,
      );

    if (dto.noBroadcastVerified !== true)
      throw new BadRequestException('On-chain absence must be verified and confirmed (noBroadcastVerified)');

    // Atomic conditional transition — a concurrent state change (e.g. late confirmation) must not be resurrected.
    const [, update] = payIn.resetSend();
    const result = await this.payInRepository.update({ id: payIn.id, status: PayInStatus.SEND_UNCERTAIN }, update);
    if (!result.affected) throw new ConflictException(`CryptoInput ${dto.id} changed state concurrently, not retried`);

    this.logger.info(
      `Manual pay-in send retry authorized for input ${dto.id} by account ${accountId}: status ${PayInStatus.SEND_UNCERTAIN} -> ${update.status}, reference: ${dto.verificationReference}`,
    );
  }

  // --- JOBS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.PAY_IN, timeout: 7200 })
  async forwardPayInEntries(): Promise<void> {
    await this.forwardPayIns();
    await this.processStrandedSendingPayIns();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.PAY_IN, timeout: 7200 })
  async returnPayInEntries(): Promise<void> {
    await this.returnPayIns();
    await this.processStrandedSendingPayIns();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.PAY_IN, timeout: 7200 })
  async checkConfirmations(): Promise<void> {
    await this.checkInputConfirmations();
    await this.checkOutputConfirmations();
    await this.checkReturnConfirmations();
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { scope: CronScope.WORKER, process: Process.PAY_IN, timeout: 7200 })
  async updateFailedPayments(): Promise<void> {
    const checkDate = Util.minutesBefore(15);

    const recentlyFailedPayments = await this.payInRepository.find({
      where: {
        created: MoreThan(checkDate),
        txType: PayInType.PAYMENT,
        status: PayInStatus.FAILED,
        asset: { priceRule: Not(IsNull()) },
      },
      relations: { asset: { priceRule: true } },
    });

    for (const failedPayment of recentlyFailedPayments) {
      // Unknown or unpriced tokens are intentionally persisted as FAILED by the register flow. They must
      // never be resurrected by the payment-quote retry, otherwise the minute job processes an input that
      // cannot be priced. Keep this guard in addition to the SQL filter as a fail-closed service boundary.
      if (!failedPayment.asset?.priceRule) {
        // The SQL filter above already requires asset.priceRule IS NOT NULL, so reaching this branch means
        // the relation drifted from the filter between query and iteration — investigate the pay-in.
        this.logger.warn(`Pay-in ${failedPayment.id} filtered out despite priceRule filter; skipping retry`);
        continue;
      }

      try {
        const quote = await this.paymentLinkPaymentService.getPaymentQuoteByFailedCryptoInput(failedPayment);

        if (quote) {
          failedPayment.paymentQuote = quote;
          failedPayment.paymentLinkPayment = failedPayment.paymentQuote.payment;
          failedPayment.status = PayInStatus.CREATED;
          await this.payInRepository.save(failedPayment);
        }
      } catch {
        // do nothing
      }
    }
  }

  // --- HELPER METHODS --- //

  private async forwardPayIns(): Promise<void> {
    // 1. Get confirmed PayIns (existing behavior)
    const confirmedPayIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.FORWARD,
        outTxId: IsNull(),
        asset: Not(IsNull()),
        isConfirmed: true,
      },
      relations: { buyCrypto: true, buyFiat: true },
    });

    // 2. Get unconfirmed next-block candidates (new behavior)
    const unconfirmedPayIns = await this.getUnconfirmedNextBlockPayIns();

    const allPayIns = [...confirmedPayIns, ...unconfirmedPayIns];

    if (allPayIns.length === 0) return;

    const groups = this.groupByStrategies(allPayIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.doSend(payIns, SendType.FORWARD);
      } catch (e) {
        this.logger.info(`Failed to forward ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`, e);
        continue;
      }
    }
  }

  private async getUnconfirmedNextBlockPayIns(): Promise<CryptoInput[]> {
    const chains = [
      {
        blockchain: Blockchain.BITCOIN,
        enabled: Config.blockchain.default.allowUnconfirmedUtxos,
        service: this.payInBitcoinService,
      },
      {
        blockchain: Blockchain.FIRO,
        enabled: Config.blockchain.firo.allowUnconfirmedUtxos,
        service: this.payInFiroService,
      },
    ].filter((c) => c.enabled && c.service.isAvailable());

    if (chains.length === 0) return [];

    const candidates = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.FORWARD,
        outTxId: IsNull(),
        asset: Not(IsNull()),
        isConfirmed: false,
      },
      relations: { buyCrypto: true, buyFiat: true, asset: true },
    });

    if (candidates.length === 0) return [];

    const allNextBlockCandidates: CryptoInput[] = [];
    const allFailedPayIns: CryptoInput[] = [];

    for (const { blockchain, service } of chains) {
      const chainCandidates = candidates.filter((p) => p.asset?.blockchain === blockchain);
      if (chainCandidates.length === 0) continue;

      try {
        const { nextBlockCandidates, failedPayIns } = await service.filterUnconfirmedPayInsForForward(chainCandidates);
        allNextBlockCandidates.push(...nextBlockCandidates);
        allFailedPayIns.push(...failedPayIns);
      } catch (e) {
        this.logger.error(`Failed to filter unconfirmed ${blockchain} PayIns:`, e);
      }
    }

    if (allFailedPayIns.length > 0) {
      await this.payInRepository.save(allFailedPayIns);
    }

    return allNextBlockCandidates;
  }

  private async checkOutputConfirmations(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: { status: PayInStatus.FORWARDED },
      take: 10000,
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.checkConfirmations(payIns, PayInConfirmationType.OUTPUT);
      } catch (e) {
        this.logger.info(
          `Failed to check forward confirmations for ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`,
          e,
        );
        continue;
      }
    }
  }

  private async checkReturnConfirmations(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: { status: PayInStatus.RETURNED },
      take: 10000,
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.checkConfirmations(payIns, PayInConfirmationType.RETURN);
      } catch (e) {
        this.logger.info(
          `Failed to check return confirmations for ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`,
          e,
        );
        continue;
      }
    }
  }

  private async returnPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.TO_RETURN, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.RETURN,
        returnTxId: IsNull(),
        asset: Not(IsNull()),
        chargebackAmount: Not(IsNull()),
        isConfirmed: true,
      },
      relations: { buyCrypto: true, buyFiat: true },
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.doSend(payIns, SendType.RETURN);
      } catch (e) {
        this.logger.info(`Failed to return ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`, e);
        continue;
      }
    }
  }

  private async processStrandedSendingPayIns(): Promise<void> {
    // An in-flight dispatch holds Sending for seconds. Ten minutes only matches crash leftovers or
    // ambiguous-broadcast strandings, never the other pay-in cron's live work.
    const payIns = await this.payInRepository.find({
      where: { status: PayInStatus.SENDING, updated: LessThan(Util.minutesBefore(10)) },
      select: { id: true },
      loadEagerRelations: false,
    });

    if (payIns.length === 0) return;

    const ids: number[] = [];
    for (const payIn of payIns) {
      try {
        const { affected } = await this.payInRepository.update(
          { id: payIn.id, status: PayInStatus.SENDING },
          { status: PayInStatus.SEND_UNCERTAIN },
        );

        if (affected === 1) {
          ids.push(payIn.id);
        } else {
          this.logger.warn(`Skipped escalation of pay-in ${payIn.id}: Sending status changed concurrently`);
        }
      } catch (e) {
        this.logger.warn(`Failed to escalate stranded Sending pay-in ${payIn.id}:`, e);
      }
    }

    if (ids.length === 0) return;

    const errorMessage = `Pay-ins left in Sending require manual investigation: ${ids.join(', ')}`;
    this.logger.error(errorMessage);
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Pay-in send uncertain',
        errors: [errorMessage],
        isLiqMail: true,
      },
      correlationId: ids.map((id) => `|${id}|`).join(''),
      options: { suppressRecurring: true },
    });
  }

  private async checkInputConfirmations(): Promise<void> {
    const payIns = await this.payInRepository.findBy({
      isConfirmed: false,
      status: Not(PayInStatus.FAILED),
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.checkConfirmations(payIns, PayInConfirmationType.INPUT);
      } catch (e) {
        this.logger.info(
          `Failed to check input confirmations for ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`,
          e,
        );
        continue;
      }
    }
  }

  private groupByStrategies<T>(payIns: CryptoInput[], getter: (asset: Asset) => T): Map<T, CryptoInput[]> {
    const groups = new Map<T, CryptoInput[]>();

    for (const payIn of payIns) {
      const sendStrategy = getter(payIn.asset);

      if (!sendStrategy) {
        this.logger.warn(`No SendStrategy found by getter ${getter.name} for pay-in ${payIn.id}. Ignoring the pay-in`);
        continue;
      }

      const group = groups.get(sendStrategy) ?? [];
      group.push(payIn);

      groups.set(sendStrategy, group);
    }

    return groups;
  }
}
