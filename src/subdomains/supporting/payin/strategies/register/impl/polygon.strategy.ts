import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInPolygonService } from '../../../services/payin-polygon.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class PolygonStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(PolygonStrategy);

  constructor(polygonService: PayInPolygonService) {
    super(polygonService);
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
    return Blockchain.POLYGON;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.polygon.polygonWalletAddress];
  }
}
