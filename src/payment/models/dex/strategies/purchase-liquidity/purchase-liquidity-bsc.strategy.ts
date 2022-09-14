import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { DexBscService } from '../../services/dex-bsc.service';
import { PurchaseLiquidityEvmStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityBscStrategy extends PurchaseLiquidityEvmStrategy {
  constructor(notificationService: NotificationService, dexBscService: DexBscService) {
    super(notificationService, dexBscService);
  }
}
