import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { AutoConfirmStrategy } from './base/auto-confirm.strategy';

@Injectable()
export class CardanoStrategy extends AutoConfirmStrategy {
  constructor(private readonly assetService: AssetService, payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCardanoCoin();
  }
}
