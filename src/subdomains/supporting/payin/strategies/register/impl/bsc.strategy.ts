import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInFactory } from '../../../factories/payin.factory';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmStrategy } from './base/evm.strategy';
import { PayInService } from '../../../services/payin.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class BscStrategy extends EvmStrategy {
  protected readonly logger = new DfxLogger(BscStrategy);

  constructor(
    dexService: DexService,
    @Inject(forwardRef(() => PayInService))
    payInService: PayInService,
    bscService: PayInBscService,
    payInFactory: PayInFactory,
    payInRepository: PayInRepository,
    assetService: AssetService,
    repos: RepositoryFactory,
  ) {
    super(
      Blockchain.BINANCE_SMART_CHAIN,
      'BNB',
      dexService,
      payInService,
      bscService,
      payInFactory,
      payInRepository,
      assetService,
      repos,
    );
  }

  //*** PUBLIC API ***//

  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const btc = await this.assetService.getAssetByQuery({
      dexName: 'BTCB',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.TOKEN,
    });

    const usdt = await this.assetService.getAssetByQuery({
      dexName: 'BUSD',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.TOKEN,
    });

    for (const entry of entries) {
      try {
        if (!entry.asset) throw new Error('No asset identified for BSC pay-in');

        const btcAmount = await this.getReferenceAmount(entry.asset, entry.amount, btc);
        const usdtAmount = await this.getReferenceAmount(entry.asset, entry.amount, usdt);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        this.logger.error('Could not set reference amounts for BSC pay-in:', e);
        continue;
      }
    }
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.bsc.bscWalletAddress];
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }
}
