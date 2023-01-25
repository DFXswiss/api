import { v4 as uuid } from 'uuid';
import { Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { PayInRepository } from '../repositories/payin.repository';
import { CryptoInput, PayInPurpose, PayInSendType, PayInStatus } from '../entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SendStrategiesFacade } from '../strategies/send/send.facade';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { In, IsNull, Not } from 'typeorm';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInEntry } from '../interfaces';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { PriceRequest, PriceResult } from '../../pricing/interfaces';
import { PricingService } from '../../pricing/services/pricing.service';
import { PriceRequestContext } from '../../pricing/enums';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { RegisterStrategiesFacade } from '../strategies/register/register.facade';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';

@Injectable()
export class PayInService {
  private readonly forwardLock = new Lock(7200);
  private readonly returnLock = new Lock(7200);
  private readonly retryLock = new Lock(7200);

  constructor(
    private readonly pricingService: PricingService,
    private readonly payInRepository: PayInRepository,
    private readonly sendStrategies: SendStrategiesFacade,
    private readonly registerStrategies: RegisterStrategiesFacade,
  ) {}

  //*** PUBLIC API ***//

  async getNewPayIns(): Promise<CryptoInput[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED });
  }

  async getNewPayInsForBlockchain(blockchain: Blockchain): Promise<CryptoInput[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED, address: { blockchain } });
  }

  // TODO -> Question -> how buyFiat and cryptoStaking are used?
  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return await this.payInRepository.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: ['route', 'route.user'],
      // relations: ['buyFiat', 'cryptoStaking', 'route', 'route.user'],
    });
  }

  async acknowledgePayIn(
    payInId: number,
    purpose: PayInPurpose,
    route: Staking | Sell | CryptoRoute,
  ): Promise<AmlCheck> {
    const payIn = await this.payInRepository.findOne(payInId);

    const amlCheck = await this.doAmlCheck(payIn, route);

    payIn.acknowledge(purpose, route, amlCheck);

    await this.payInRepository.save(payIn);

    return amlCheck;
  }

  async returnPayIn(
    payInId: number,
    purpose: PayInPurpose,
    returnAddress: BlockchainAddress,
    route: DepositRoute,
  ): Promise<void> {
    const payIn = await this.payInRepository.findOne(payInId);

    payIn.triggerReturn(purpose, returnAddress, route);

    await this.payInRepository.save(payIn);
  }

  async failedPayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.fail(purpose);

    await this.payInRepository.save(_payIn);
  }

  async ignorePayIn(payIn: CryptoInput, purpose: PayInPurpose, route: DepositRoute): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.ignore(purpose, route);

    await this.payInRepository.save(_payIn);
  }

  //*** PUBLIC HELPER METHODS ***//

  async getReferencePricesLegacy(entries: PayInEntry[] | CryptoInput[]): Promise<Price[]> {
    const referenceAssetPairs = [
      ...new Set([...entries.map((p) => `${p.asset.dexName}/BTC`), ...entries.map((p) => `${p.asset.dexName}/USDT`)]),
    ].map((assets) => assets.split('/'));

    const prices = await Promise.all<PriceResult>(
      referenceAssetPairs.map(async (pair) => {
        const priceRequest = this.createPriceRequest(pair);

        return this.pricingService.getPrice(priceRequest).catch((e) => {
          console.error('Failed to get price:', e);
          return undefined;
        });
      }),
    );

    return prices.filter((p) => p).map((p) => p.price);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  async forwardPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.forwardLock.acquire()) return;

    try {
      await this.forwardPayIns();
    } catch (e) {
      console.error('Exception during forwarding pay-ins:', e);
    } finally {
      this.forwardLock.release();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async returnPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.returnLock.acquire()) return;

    try {
      await this.returnPayIns();
    } catch (e) {
      console.error('Exception during returning pay-ins:', e);
    } finally {
      this.returnLock.release();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryGettingReferencePrices(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.retryLock.acquire()) return;

    try {
      await this.retryPayIns();
    } catch (e) {
      console.error('Exception during retry of getting reference prices for pay-ins:', e);
    } finally {
      this.retryLock.release();
    }
  }

  //*** HELPER METHODS ***//

  async doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<AmlCheck> {
    try {
      const strategy = this.registerStrategies.getRegisterStrategy(payIn.asset);
      return strategy.doAmlCheck(payIn, route);
    } catch (e) {
      console.error(`Error during AML check for pay-in ID: ${payIn.id}`, e);
    }
  }

  private async forwardPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        sendType: PayInSendType.FORWARD,
        outTxId: IsNull(),
        amlCheck: AmlCheck.PASS,
      },
      relations: ['route'],
    });

    const groups = this.groupByStrategies(payIns, this.sendStrategies.getSendStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.sendStrategies.getSendStrategy(group[0]);
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
      },
      relations: ['route'],
    });

    const groups = this.groupByStrategies(payIns, this.sendStrategies.getSendStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.sendStrategies.getSendStrategy(group[0]);
        await strategy.doSend(group[1], SendType.RETURN);
      } catch {
        continue;
      }
    }
  }

  private groupByStrategies<T>(payIns: CryptoInput[], getter: (asset: Asset) => T): Map<T, CryptoInput[]> {
    const groups = new Map<T, CryptoInput[]>();

    for (const payIn of payIns) {
      const alias = getter(payIn.asset);

      if (!alias) {
        console.warn(`No alias found by getter ${getter.name} for payIn ID ${payIn.id}. Ignoring the payIn`);
        continue;
      }

      const group = groups.get(alias) ?? [];
      group.push(payIn);

      groups.set(alias, group);
    }

    return groups;
  }

  private async retryPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: { status: PayInStatus.WAITING_FOR_PRICE_REFERENCE },
      relations: ['route'],
    });

    const groups = this.groupByStrategies(payIns, this.registerStrategies.getRegisterStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.registerStrategies.getRegisterStrategy(group[0]);
        await strategy.addReferenceAmounts(group[1]);
      } catch {
        continue;
      }
    }
  }

  private createPriceRequest(currencyPair: string[]): PriceRequest {
    const correlationId = 'PayIn' + uuid();
    return { context: PriceRequestContext.PAY_IN, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
