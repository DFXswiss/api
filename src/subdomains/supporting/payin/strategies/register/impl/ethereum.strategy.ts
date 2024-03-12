import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(EthereumStrategy);

  constructor(ethereumService: PayInEthereumService) {
    super(ethereumService);
  }

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();
    this.assetTransfersMessageQueue = new QueueHandler();

    this.alchemyWebhookService
      .getAddressWebhookObservable(AlchemyNetworkMapper.toAlchemyNetworkByBlockchain(this.blockchain))
      .subscribe((dto) => this.processAddressWebhookMessageQueue(dto));

    this.alchemyService
      .getAssetTransfersObservable(this.blockchain)
      .subscribe((at) => this.processAssetTransfersMessageQueue(at));
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
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
    return asset;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.ethereum.ethWalletAddress];
  }
}
