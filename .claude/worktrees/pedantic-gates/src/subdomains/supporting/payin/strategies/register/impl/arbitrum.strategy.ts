import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { AlchemyStrategy } from './base/alchemy.strategy';

@Injectable()
export class ArbitrumStrategy extends AlchemyStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(ArbitrumStrategy);

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
    return Blockchain.ARBITRUM;
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
}
