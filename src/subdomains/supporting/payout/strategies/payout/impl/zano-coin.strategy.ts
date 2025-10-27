import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutZanoService } from '../../../services/payout-zano.service';
import { ZanoStrategy } from './base/zano.strategy';

@Injectable()
export class ZanoCoinStrategy extends ZanoStrategy {
  protected readonly logger = new DfxLogger(ZanoCoinStrategy);

  constructor(
    readonly notificationService: NotificationService,
    readonly payoutOrderRepo: PayoutOrderRepository,
    readonly payoutZanoService: PayoutZanoService,
    readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, payoutZanoService, assetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async hasEnoughUnlockedBalance(orders: PayoutOrder[]): Promise<boolean> {
    const totalOrderAmount = Util.sumObjValue<PayoutOrder>(orders, 'amount');
    const unlockedBalance = await this.payoutZanoService.getUnlockedCoinBalance();

    return totalOrderAmount <= unlockedBalance;
  }

  async dispatchPayout(_: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.payoutZanoService.sendCoins(payout);
  }
}
