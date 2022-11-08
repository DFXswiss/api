import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(
    private readonly assetService: AssetService,
    notificationService: NotificationService,
    dexEthereumService: DexEthereumService,
  ) {
    super(notificationService, dexEthereumService);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'ETH', blockchain: Blockchain.ETHEREUM, type: AssetType.COIN });
  }
}
