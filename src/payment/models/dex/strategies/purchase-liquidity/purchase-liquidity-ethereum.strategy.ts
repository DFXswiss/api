import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { PurchaseLiquidityEvmStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityEthereumStrategy extends PurchaseLiquidityEvmStrategy {
  constructor(notificationService: NotificationService, dexEthereumService: DexEthereumService) {
    super(notificationService, dexEthereumService);
  }
}
