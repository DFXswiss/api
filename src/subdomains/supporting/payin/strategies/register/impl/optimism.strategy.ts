import { Injectable, OnModuleInit } from '@nestjs/common';
import { Network } from 'alchemy-sdk';
import { filter } from 'rxjs';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class OptimismStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(OptimismStrategy);

  constructor(
    optimismService: PayInOptimismService,
    payInRepository: PayInRepository,
    assetService: AssetService,
    repos: RepositoryFactory,
  ) {
    super('ETH', optimismService, payInRepository, assetService, repos);
  }

  onModuleInit() {
    this.addressWebhookMessageQueue = new QueueHandler();

    this.alchemyService
      .getAddressWebhookObservable()
      .pipe(filter((data) => [Network.OPT_MAINNET, Network.OPT_GOERLI].includes(Network[data.event.network])))
      .subscribe((dto) => this.processAddressWebhookMessageQueue(dto));
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
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
      dexName: asset.dexName,
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
    return [Config.blockchain.optimism.optimismWalletAddress];
  }

  //*** JOBS ***//
  async checkPayInEntries(): Promise<void> {
    this.logger.info('Optimism checkPayInEntries() ...');
    await this.processNewPayInEntries();
  }
}
