import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutOptimismService } from '../../../services/payout-optimism.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly optimismService: PayoutOptimismService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(optimismService, payoutOrderRepo);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.optimismService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.optimismService.getCurrentGasForTokenTransaction(token);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getOptimismCoin();
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.optimismService.getPayoutCompletionData(payoutTxId);
  }
}
