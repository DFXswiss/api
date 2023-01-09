import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArbitrumService } from '../../../services/payout-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly arbitrumService: PayoutArbitrumService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(arbitrumService, payoutOrderRepo);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.arbitrumService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.arbitrumService.getCurrentGasForTokenTransaction(token);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
