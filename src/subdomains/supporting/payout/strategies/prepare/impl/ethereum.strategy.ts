import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  constructor(protected readonly assetService: AssetService, payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'ETH', blockchain: Blockchain.ETHEREUM, type: AssetType.COIN });
  }
}
