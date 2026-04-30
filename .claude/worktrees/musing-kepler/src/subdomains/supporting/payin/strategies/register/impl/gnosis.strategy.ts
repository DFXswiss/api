import { Injectable, OnModuleInit } from '@nestjs/common';
import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { map } from 'rxjs';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { AlchemyStrategy } from './base/alchemy.strategy';

@Injectable()
export class GnosisStrategy extends AlchemyStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(GnosisStrategy);

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();
    this.assetTransfersMessageQueue = new QueueHandler();

    this.alchemyWebhookService
      .getAddressWebhookObservable(AlchemyNetworkMapper.toAlchemyNetworkByBlockchain(this.blockchain))
      .pipe(map((dto) => this.changeAssetFromWebhook(dto)))
      .subscribe((dto) => this.processAddressWebhookMessageQueue(dto));

    this.alchemyService
      .getAssetTransfersObservable(this.blockchain)
      .pipe(map((at) => this.changeAssetFromTransfer(at)))
      .subscribe((at) => this.processAssetTransfersMessageQueue(at));
  }

  // Only needed, because of receiving "ETH" Asset instead of "xDAI" Asset
  private changeAssetFromWebhook(dto: AlchemyWebhookDto): AlchemyWebhookDto {
    for (const activity of dto.event.activity) {
      if (!activity.rawContract?.address && activity.asset === 'ETH') activity.asset = 'xDAI';
    }

    return dto;
  }

  // Only needed, because of receiving "ETH" Asset instead of "xDAI" Asset
  private changeAssetFromTransfer(
    assetTransfers: AssetTransfersWithMetadataResult[],
  ): AssetTransfersWithMetadataResult[] {
    for (const assetTransfer of assetTransfers) {
      if (!assetTransfer.rawContract?.address && assetTransfer.asset === 'ETH') assetTransfer.asset = 'xDAI';
    }

    return assetTransfers;
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.gnosis.gnosisWalletAddress];
  }
}
