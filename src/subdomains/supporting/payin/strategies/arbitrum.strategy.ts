import { Injectable } from '@nestjs/common';
import { EvmStrategy } from './base/evm.strategy';
import { Lock } from 'src/shared/utils/lock';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { PayInArbitrumService } from '../services/payin-arbitrum.service';

@Injectable()
export class ArbitrumStrategy extends EvmStrategy {
  private readonly lock = new Lock(7200);

  constructor(arbitrumService: PayInArbitrumService) {
    super(arbitrumService);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during Arbitrum pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }
}
