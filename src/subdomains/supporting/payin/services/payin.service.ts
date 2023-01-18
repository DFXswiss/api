import { Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { PayInRepository } from '../repositories/payin.repository';
import { CryptoInput, PayInPurpose, PayInStatus } from '../entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ForwardStrategiesFacade } from '../strategies/forward/forward.facade';
import { ReturnStrategiesFacade } from '../strategies/return/return.facade';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IsNull } from 'typeorm';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';

@Injectable()
export class PayInService {
  private readonly forwardLock = new Lock(7200);
  private readonly returnLock = new Lock(7200);

  constructor(
    private readonly payInRepository: PayInRepository,
    private readonly forwardStrategies: ForwardStrategiesFacade,
    private readonly returnStrategies: ReturnStrategiesFacade,
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

  async returnPayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.designateReturn(purpose);

    await this.payInRepository.save(_payIn);
  }

  async failedPayIn(payIn: CryptoInput, purpose: PayInPurpose): Promise<void> {
    const _payIn = await this.payInRepository.findOne(payIn.id);

    _payIn.fail(purpose);

    await this.payInRepository.save(_payIn);
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

    const groups = this.groupByPayInStrategies(payIns, this.forwardStrategies.getForwardStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.forwardStrategies.getForwardStrategy(group[0]);
        await strategy.doForward(group[1]);
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

    const groups = this.groupByPayInStrategies(payIns, this.returnStrategies.getReturnStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.returnStrategies.getReturnStrategy(group[0]);
        await strategy.doReturn(group[1]);
      } catch {
        continue;
      }
    }
  }

  private groupByPayInStrategies<T>(payIns: CryptoInput[], getter: (asset: Asset) => T): Map<T, CryptoInput[]> {
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
}
