import { Injectable } from '@nestjs/common';
import { EvmStrategy } from './base/evm.strategy';
import { Lock } from 'src/shared/utils/lock';
import { PayInOptimismService } from '../services/payin-optimism.service';
import { Config, Process } from 'src/config/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInRepository } from '../repositories/payin.repository';
import { PayInFactory } from '../factories/payin.factory';

@Injectable()
export class OptimismStrategy extends EvmStrategy {
  private readonly lock = new Lock(7200);

  constructor(optimismService: PayInOptimismService, payInFactory: PayInFactory, payInRepository: PayInRepository) {
    super(Blockchain.OPTIMISM, optimismService, payInFactory, payInRepository);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during Optimism pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }
}
