import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutTronService } from '../../../services/payout-tron.service';
import { TronStrategy } from './base/tron.strategy';

@Injectable()
export class TronTokenStrategy extends TronStrategy {
  constructor(
    protected readonly tronService: PayoutTronService,
    private readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(tronService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getTronCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.tronService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.tronService.getCurrentGasForTokenTransaction(token);
  }
}
