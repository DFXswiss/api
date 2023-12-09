import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumStrategy extends EvmStrategy {
  protected readonly logger = new DfxLogger(ArbitrumStrategy);

  constructor(
    arbitrumService: PayInArbitrumService,
    payInRepository: PayInRepository,
    assetService: AssetService,
    repos: RepositoryFactory,
    private readonly processService: ProcessService,
  ) {
    super('ETH', arbitrumService, payInRepository, assetService, repos);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  //*** PUBLIC API ***//

  async getReferenceAssets(): Promise<{ btc: Asset; usdt: Asset }> {
    return Promise.all([
      this.assetService.getAssetByQuery({
        dexName: 'WBTC',
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
      }),
      this.assetService.getAssetByQuery({
        dexName: 'USDT',
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
      }),
    ]).then(([btc, usdt]) => ({ btc, usdt }));
  }

  async getSourceAssetRepresentation(asset: Asset): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: asset.dexName.split('.')[0], // workaround for bridged USDC (USDC.e)
      blockchain: Blockchain.ETHEREUM,
      type: asset.type,
    });
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.arbitrum.arbitrumWalletAddress];
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (await this.processService.isDisableProcess(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }
}
