import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
    alchemyService: AlchemyService,
  ) {
    super('ETH', arbitrumService, payInRepository, assetService, repos, alchemyService);
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

  async checkPayInEntries(): Promise<void> {
    this.logger.info('Arbitrum checkPayInEntries() ...');
    await this.processNewPayInEntries();
  }
}
