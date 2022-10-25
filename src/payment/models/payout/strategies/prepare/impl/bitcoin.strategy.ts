import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { AutoConfirmStrategy } from './base/auto-confirm.strategy';

@Injectable()
export class BitcoinStrategy extends AutoConfirmStrategy {
  constructor(protected readonly assetService: AssetService, payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'BTC', blockchain: Blockchain.BITCOIN, type: AssetType.COIN });
  }
}
