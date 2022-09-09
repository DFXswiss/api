import { Injectable } from '@nestjs/common';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../services/dex-defichain.service';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { PurchaseLiquidityDeFiChainNonPoolPairStrategy } from './base/purchase-liquidity-defichain-non-poolpair.strategy';

@Injectable()
export class PurchaseLiquidityDeFiChainCryptoStrategy extends PurchaseLiquidityDeFiChainNonPoolPairStrategy {
  constructor(
    readonly mailService: MailService,
    readonly dexDeFiChainService: DexDeFiChainService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(mailService, dexDeFiChainService, liquidityOrderRepo, liquidityOrderFactory, ['DFI']);
  }
}
