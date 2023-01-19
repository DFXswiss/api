import { v4 as uuid } from 'uuid';
import { Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { PayInRepository } from '../repositories/payin.repository';
import { CryptoInput, PayInPurpose, PayInStatus } from '../entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SendStrategiesFacade, SendStrategyAlias } from '../strategies/send/send.facade';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { IsNull } from 'typeorm';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { SendType } from '../strategies/send/impl/base/send.strategy';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInEntry } from '../interfaces';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { PriceRequest, PriceResult } from '../../pricing/interfaces';
import { PricingService } from '../../pricing/services/pricing.service';
import { PriceRequestContext } from '../../pricing/enums';

@Injectable()
export class PayInService {
  private readonly forwardLock = new Lock(7200);
  private readonly returnLock = new Lock(7200);
  private readonly retryLock = new Lock(7200);

  constructor(
    private readonly pricingService: PricingService,
    private readonly payInRepository: PayInRepository,
    private readonly sendStrategies: SendStrategiesFacade,
  ) {}

  //*** PUBLIC API ***//

  async getNewPayIns(): Promise<CryptoInput[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED });
  }

  async getNewPayInsForBlockchain(blockchain: Blockchain): Promise<CryptoInput[]> {
    return this.payInRepository.find({ status: PayInStatus.CREATED, address: { blockchain } });
  }

  async acknowledgePayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.acknowledge(purpose);

    await this.payInRepository.save(_payIn);
  }

  async returnPayIn(payIn: CryptoInput, purpose: PayInPurpose, returnAddress: BlockchainAddress): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.triggerReturn(purpose, returnAddress);

    await this.payInRepository.save(_payIn);
  }

  async failedPayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.fail(purpose);

    await this.payInRepository.save(_payIn);
  }

  //*** PUBLIC HELPER METHODS ***//

  async getReferencePrices(entries: PayInEntry[] | CryptoInput[]): Promise<Price[]> {
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

  private async forwardPayIns(): Promise<void> {
    const payIns = await this.payInRepository.find({
      where: {
        status: PayInStatus.ACKNOWLEDGED,
        outTxId: IsNull(),
        amlCheck: AmlCheck.PASS,
      },
      relations: ['route'],
    });

    const groups = this.groupByPayInStrategies(payIns);

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
      where: { status: PayInStatus.TO_RETURN, returnTxId: IsNull() },
      relations: ['route'],
    });

    const groups = this.groupByPayInStrategies(payIns);

    for (const group of groups.entries()) {
      try {
        const strategy = this.sendStrategies.getSendStrategy(group[0]);
        await strategy.doSend(group[1], SendType.RETURN);
      } catch {
        continue;
      }
    }
  }

  private groupByPayInStrategies(payIns: CryptoInput[]): Map<SendStrategyAlias, CryptoInput[]> {
    const groups = new Map<SendStrategyAlias, CryptoInput[]>();

    for (const payIn of payIns) {
      const alias = this.sendStrategies.getSendStrategyAlias(payIn.asset);

      if (!alias) {
        console.warn(`No SendStrategyAlias found for pay-in ID ${payIn.id}. Ignoring the pay-in`);
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

    const referencePrices = await this.getReferencePrices(payIns);

    for (const payIn of payIns) {
      try {
        payIn.addReferenceAmounts(referencePrices);
        await this.payInRepository.save(payIn);
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
