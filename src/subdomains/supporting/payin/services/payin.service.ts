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

@Injectable()
export class PayInService {
  private readonly forwardLock = new Lock(7200);
  private readonly returnLock = new Lock(7200);

  constructor(
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
}
