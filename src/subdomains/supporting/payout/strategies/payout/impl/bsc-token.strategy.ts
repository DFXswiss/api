import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly bscService: PayoutBscService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(bscService, payoutOrderRepo);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.bscService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.bscService.getCurrentGasForTokenTransaction(token);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBnbCoin();
  }
}
