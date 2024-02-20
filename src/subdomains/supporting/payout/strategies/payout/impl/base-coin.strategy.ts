import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBaseService } from '../../../services/payout-base.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BaseCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly baseService: PayoutBaseService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(baseService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.baseService.sendNativeCoin(order.destinationAddress, order.amount);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.baseService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBaseCoin();
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.baseService.getPayoutCompletionData(payoutTxId);
  }
}
