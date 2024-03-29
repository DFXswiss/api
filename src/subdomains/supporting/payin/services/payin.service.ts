import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { DepositRouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { In, IsNull, Not } from 'typeorm';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { CryptoInput, PayInPurpose, PayInSendType, PayInStatus } from '../entities/crypto-input.entity';
import { PayInRepository } from '../repositories/payin.repository';
import { RegisterStrategyRegistry } from '../strategies/register/impl/base/register.strategy-registry';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { SendStrategyRegistry } from '../strategies/send/impl/base/send.strategy-registry';

@Injectable()
export class PayInService {
  private readonly logger = new DfxLogger(PayInService);

  constructor(
    private readonly payInRepository: PayInRepository,
    private readonly sendStrategyRegistry: SendStrategyRegistry,
    private readonly registerStrategyRegistry: RegisterStrategyRegistry,
    private readonly transactionService: TransactionService,
  ) {}

  //*** PUBLIC API ***//

  async getNewPayIns(): Promise<CryptoInput[]> {
    return this.payInRepository.find({ where: { status: PayInStatus.CREATED }, relations: { transaction: true } });
  }

  async getNewPayInsForBlockchain(blockchain: Blockchain): Promise<CryptoInput[]> {
    return this.payInRepository.findBy({ status: PayInStatus.CREATED, address: { blockchain } });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return this.payInRepository.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: ['route', 'route.user'],
      order: { id: 'DESC' },
    });
  }

  async acknowledgePayIn(
    payInId: number,
    purpose: PayInPurpose,
    route: Staking | Sell | CryptoRoute,
  ): Promise<CheckStatus> {
    const payIn = await this.payInRepository.findOneBy({ id: payInId });

    const amlCheck = await this.doAmlCheck(payIn, route);

    payIn.acknowledge(purpose, route, amlCheck);

    await this.payInRepository.save(payIn);

    return amlCheck;
  }

  async returnPayIn(
    payIn: CryptoInput,
    purpose: PayInPurpose,
    returnAddress: BlockchainAddress,
    route: Staking | Sell | CryptoRoute,
  ): Promise<void> {
    const amlCheck = await this.doAmlCheck(payIn, route);

    payIn.triggerReturn(purpose, returnAddress, route, amlCheck);

    if (payIn.transaction)
      await this.transactionService.update(payIn.transaction.id, { type: TransactionTypeInternal.CRYPTO_INPUT_RETURN });

    await this.payInRepository.save(payIn);
  }

  async failedPayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOneBy({ id: payIn.id });

    _payIn.fail(purpose);

    await this.payInRepository.save(_payIn);
  }

  async ignorePayIn(payIn: CryptoInput, purpose: PayInPurpose, route: DepositRouteType): Promise<void> {
    const _payIn = await this.payInRepository.findOneBy({ id: payIn.id });

    _payIn.ignore(purpose, route);

    await this.payInRepository.save(_payIn);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async forwardPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.forwardPayIns();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async returnPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.returnPayIns();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkInputConfirmations(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.checkConfirmations();
  }

  //*** HELPER METHODS ***//

  async doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<CheckStatus> {
    try {
      const strategy = this.registerStrategyRegistry.getRegisterStrategy(payIn.asset);
      return await strategy.doAmlCheck(payIn, route);
    } catch (e) {
      this.logger.error(`Error during AML check for pay-in ${payIn.id}:`, e);
    }
  }

  private async forwardPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        sendType: PayInSendType.FORWARD,
        outTxId: IsNull(),
        amlCheck: CheckStatus.PASS,
        asset: Not(IsNull()),
      },
      relations: ['route', 'asset'],
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.doSend(group[1], SendType.FORWARD);
      } catch {
        continue;
      }
    }
  }

  private async returnPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.TO_RETURN, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        sendType: PayInSendType.RETURN,
        returnTxId: IsNull(),
        amlCheck: CheckStatus.PASS,
        asset: Not(IsNull()),
      },
      relations: ['route', 'asset'],
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.doSend(group[1], SendType.RETURN);
      } catch {
        continue;
      }
    }
  }

  private async checkConfirmations(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        isConfirmed: false,
        status: Not(PayInStatus.FAILED),
      },
      relations: ['route', 'asset'],
    });

    if (payIns.length === 0) return;

    const groups = this.groupByStrategies(payIns, (a) => this.sendStrategyRegistry.getSendStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.checkConfirmations(group[1]);
      } catch {
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
