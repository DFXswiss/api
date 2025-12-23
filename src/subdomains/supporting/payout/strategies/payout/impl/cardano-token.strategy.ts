import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutCardanoService } from '../../../services/payout-cardano.service';
import { CardanoStrategy } from './base/cardano.strategy';

@Injectable()
export class CardanoTokenStrategy extends CardanoStrategy {
  constructor(
    protected readonly cardanoService: PayoutCardanoService,
    private readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(cardanoService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async getFeeAsset(): Promise<Asset> {
    return this.assetService.getCardanoCoin();
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.cardanoService.sendToken(order.destinationAddress, order.asset, order.amount);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.cardanoService.getCurrentGasForTokenTransaction(token);
  }
}
