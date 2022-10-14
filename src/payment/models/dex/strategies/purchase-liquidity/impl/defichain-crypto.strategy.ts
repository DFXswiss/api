import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from './base/defichain-non-poolpair.strategy';

@Injectable()
export class DeFiChainCryptoStrategy extends DeFiChainNonPoolPairStrategy {
  constructor(
    readonly notificationService: NotificationService,
    readonly dexDeFiChainService: DexDeFiChainService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(notificationService, dexDeFiChainService, liquidityOrderRepo, liquidityOrderFactory, ['DFI']);
  }
}
