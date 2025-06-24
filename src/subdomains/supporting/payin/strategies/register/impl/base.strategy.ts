import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInBaseService } from '../../../services/payin-base.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BaseStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, baseService: PayInBaseService) {
    super(baseService);

    this.logger = this.dfxLogger.create(BaseStrategy);
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
    return Blockchain.BASE;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.base.baseWalletAddress];
  }
}
