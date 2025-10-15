import { BadRequestException, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { DepositRouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { In, IsNull, MoreThan, Not } from 'typeorm';
import { TransactionSourceType, TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import {
  CryptoInput,
  PayInAction,
  PayInConfirmationType,
  PayInPurpose,
  PayInStatus,
  PayInType,
} from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';
import { PayInRepository } from '../repositories/payin.repository';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { SendStrategyRegistry } from '../strategies/send/impl/base/send.strategy-registry';

@Injectable()
export class PayInService {
  private readonly logger = new DfxLogger(PayInService);

  constructor(
    private readonly payInRepository: PayInRepository,
    private readonly sendStrategyRegistry: SendStrategyRegistry,
    private readonly transactionService: TransactionService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
  ) {}

  // --- PUBLIC API --- //

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

        payIns.push(payIn);
      }
    }

    return payIns;
  }

  async getCryptoInputByKeys(keys: string[], value: any): Promise<CryptoInput> {
    const query = this.payInRepository
      .createQueryBuilder('cryptoInput')
      .select('cryptoInput')
      .leftJoinAndSelect('cryptoInput.transaction', 'transaction')
      .leftJoinAndSelect('transaction.userData', 'userData');

    if (keys.length === 1) {
      query.where(`${keys[0].includes('.') ? keys[0] : `cryptoInput.${keys[0]}`} = :param`, { param: value });
    } else {
      for (const key of keys) {
        query.orWhere(`${key.includes('.') ? key : `cryptoInput.${key}`} = :param`, { param: value });
      }
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
        { status: PayInStatus.CREATED, txType: Not(PayInType.PERMIT_TRANSFER) },
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
    return this.payInRepository.findBy({
      status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.FORWARDED, PayInStatus.RETURNED, PayInStatus.TO_RETURN]),
      isConfirmed: true,
      txType: Not(PayInType.PAYMENT),
    });
  }

  async getPayInFee(from: Date): Promise<number> {
    const { fee } = await this.payInRepository
      .createQueryBuilder('cryptoInput')
      .select('SUM(forwardFeeAmountChf)', 'fee')
      .where('created >= :from', { from })
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

  async returnPayIn(payIn: CryptoInput, returnAddress: string, chargebackAmount: number): Promise<void> {
    if (payIn.action === PayInAction.FORWARD) throw new BadRequestException('CryptoInput already forwarded');
    if ([PayInStatus.RETURN_CONFIRMED, PayInStatus.RETURNED].includes(payIn.status) || payIn.returnTxId)
      throw new BadRequestException('CryptoInput already returned');

    payIn.triggerReturn(BlockchainAddress.create(returnAddress, payIn.asset.blockchain), chargebackAmount);

    if (payIn.transaction)
      await this.transactionService.updateInternal(payIn.transaction, {
        type: TransactionTypeInternal.CRYPTO_INPUT_RETURN,
        user: payIn.route.user,
      });

    await this.payInRepository.save(payIn);
  }

  async ignorePayIn(payIn: CryptoInput, purpose: PayInPurpose, route: DepositRouteType): Promise<void> {
    const _payIn = await this.payInRepository.findOneBy({ id: payIn.id });

    _payIn.ignore(purpose, route);

    await this.payInRepository.save(_payIn);
  }

  // --- JOBS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async forwardPayInEntries(): Promise<void> {
    await this.forwardPayIns();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async returnPayInEntries(): Promise<void> {
    await this.returnPayIns();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkConfirmations(): Promise<void> {
    await this.checkInputConfirmations();
    await this.checkOutputConfirmations();
    await this.checkReturnConfirmations();
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.PAY_IN, timeout: 7200 })
  async updateFailedPayments() {
    const checkDate = Util.minutesBefore(15);

    const recentlyFailedPayments = await this.payInRepository.find({
      where: {
        created: MoreThan(checkDate),
        txType: PayInType.PAYMENT,
        status: PayInStatus.FAILED,
      },
    });

    for (const failedPayment of recentlyFailedPayments) {
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
    const payIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.FORWARD,
        outTxId: IsNull(),
        asset: Not(IsNull()),
        isConfirmed: true,
      },
      relations: { buyCrypto: true, buyFiat: true },
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const [strategy, payIns] of groups.entries()) {
      try {
        await strategy.doSend(payIns, SendType.FORWARD);
      } catch (e) {
        this.logger.info(`Failed to forward ${strategy.assetType ?? ''} inputs on ${strategy.blockchain}:`, e);
        continue;
      }
    }
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
