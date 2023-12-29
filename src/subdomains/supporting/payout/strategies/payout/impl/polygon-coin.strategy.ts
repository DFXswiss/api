import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutPolygonService } from '../../../services/payout-polygon.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class PolygonCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly polygonService: PayoutPolygonService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(polygonService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.polygonService.sendNativeCoin(order.destinationAddress, order.amount);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.polygonService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getPolygonCoin();
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.polygonService.getPayoutCompletionData(payoutTxId);
  }
}
