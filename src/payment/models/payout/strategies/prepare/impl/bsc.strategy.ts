import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscStrategy extends EvmStrategy {
  constructor(protected readonly assetService: AssetService, payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: 'BNB',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.COIN,
    });
  }
}
