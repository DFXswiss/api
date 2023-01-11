import { Injectable } from '@nestjs/common';
import { PayInBscService } from '../services/payin-bsc.service';
import { EvmStrategy } from './base/evm.strategy';
import { Lock } from 'src/shared/utils/lock';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInRepository } from '../repositories/payin.repository';
import { PayInFactory } from '../factories/payin.factory';

@Injectable()
export class BscStrategy extends EvmStrategy {
  private readonly lock = new Lock(7200);

  constructor(bscService: PayInBscService, payInFactory: PayInFactory, payInRepository: PayInRepository) {
    super(Blockchain.BINANCE_SMART_CHAIN, bscService, payInFactory, payInRepository);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during BSC pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }
}
