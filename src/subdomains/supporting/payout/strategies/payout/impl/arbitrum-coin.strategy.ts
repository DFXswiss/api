import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArbitrumService } from '../../../services/payout-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly arbitrumService: PayoutArbitrumService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(arbitrumService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.arbitrumService.sendNativeCoin(order.destinationAddress, order.amount);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.arbitrumService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
