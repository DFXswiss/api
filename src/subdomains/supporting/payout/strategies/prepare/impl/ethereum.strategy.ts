import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  constructor(private readonly assetService: AssetService, payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getNativeCoin(this.blockchain);
  }
}
