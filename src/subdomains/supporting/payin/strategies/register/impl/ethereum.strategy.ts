import { Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { Config, Process } from 'src/config/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInFactory } from '../../../factories/payin.factory';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  private readonly lock = new Lock(7200);

  constructor(
    ethereumService: PayInEthereumService,
    payInFactory: PayInFactory,
    payInRepository: PayInRepository,
    assetService: AssetService,
  ) {
    super(Blockchain.ETHEREUM, 'ETH', ethereumService, payInFactory, payInRepository, assetService);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during Ethereum pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }
}
