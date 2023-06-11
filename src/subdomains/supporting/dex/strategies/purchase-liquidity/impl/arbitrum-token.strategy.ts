import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class ArbitrumTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexArbitrumService: DexArbitrumService,
  ) {
    super(notificationService, dexArbitrumService, 'ArbitrumToken');
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
