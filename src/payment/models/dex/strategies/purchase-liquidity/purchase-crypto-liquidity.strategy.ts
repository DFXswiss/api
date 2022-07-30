import { Injectable } from '@nestjs/common';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { LiquidityService } from '../../services/liquidity.service';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { PurchaseNonPoolPairLiquidityStrategy } from './purchase-non-poolpair-liquidity.strategy';

@Injectable()
export class PurchaseCryptoLiquidityStrategy extends PurchaseNonPoolPairLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    readonly liquidityService: LiquidityService,
    readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(mailService, liquidityService, liquidityOrderRepo, liquidityOrderFactory, ['DFI']);
  }
}
