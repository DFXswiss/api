import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from './base/defichain-non-poolpair.strategy';

@Injectable()
export class DeFiChainCryptoStrategy extends DeFiChainNonPoolPairStrategy {
  constructor(
    readonly mailService: MailService,
    readonly dexDeFiChainService: DexDeFiChainService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(mailService, dexDeFiChainService, liquidityOrderRepo, liquidityOrderFactory, ['DFI']);
  }
}
