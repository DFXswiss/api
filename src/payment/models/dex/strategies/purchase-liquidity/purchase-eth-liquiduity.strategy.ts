import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

@Injectable()
export class PurchaseETHLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService) {
    super(mailService);
  }

  purchaseLiquidity(): Promise<void> {
    return;
  }
}
