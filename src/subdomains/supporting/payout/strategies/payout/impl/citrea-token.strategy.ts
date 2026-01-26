import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutCitreaService } from '../../../services/payout-citrea.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly citreaService: PayoutCitreaService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(citreaService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.citreaService.sendToken(order.destinationAddress, order.asset, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.citreaService.getCurrentGasForTokenTransaction(token);
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaCoin();
  }
}
