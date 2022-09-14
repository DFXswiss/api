import { Injectable } from '@nestjs/common';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../services/dex-defichain.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { PurchaseLiquidityDeFiChainNonPoolPairStrategy } from './base/purchase-liquidity-defichain-non-poolpair.strategy';
import { NotificationService } from 'src/notification/services/notification.service';

@Injectable()
export class PurchaseLiquidityDeFiChainStockStrategy extends PurchaseLiquidityDeFiChainNonPoolPairStrategy {
  constructor(
    readonly notificationService: NotificationService,
    readonly dexDeFiChainService: DexDeFiChainService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(notificationService, dexDeFiChainService, liquidityOrderRepo, liquidityOrderFactory, ['DUSD', 'DFI']);
  }
}
