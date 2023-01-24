import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EvmStrategy } from './base/evm.strategy';
import { Lock } from 'src/shared/utils/lock';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInFactory } from '../../../factories/payin.factory';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { PayInService } from '../../../services/payin.service';
import { PayInEntry } from '../../../interfaces';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class ArbitrumStrategy extends EvmStrategy {
  private readonly lock = new Lock(7200);

  constructor(
    dexService: DexService,
    @Inject(forwardRef(() => PayInService))
    payInService: PayInService,
    arbitrumService: PayInArbitrumService,
    payInFactory: PayInFactory,
    payInRepository: PayInRepository,
    assetService: AssetService,
  ) {
    super(
      Blockchain.ARBITRUM,
      'ETH',
      dexService,
      payInService,
      arbitrumService,
      payInFactory,
      payInRepository,
      assetService,
    );
  }

  //*** PUBLIC API ***//

  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const btc = await this.assetService.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
    });

    const usdt = await this.assetService.getAssetByQuery({
      dexName: 'USDT',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
    });

    for (const entry of entries) {
      try {
        const btcAmount = await this.getReferenceAmount(entry.asset, entry.amount, btc);
        const usdtAmount = await this.getReferenceAmount(entry.asset, entry.amount, usdt);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        console.error('Could not set reference amounts for Arbitrum pay-in', e);
        continue;
      }
    }
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
