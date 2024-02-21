import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DexBaseService } from '../../../services/dex-base.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BaseCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    dexBaseService: DexBaseService,
  ) {
    super(notificationService, dexBaseService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBaseCoin();
  }
}
