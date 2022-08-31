import { MailService } from 'src/shared/services/mail.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export class PurchaseETHBaseLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService) {
    super(mailService);
  }

  purchaseLiquidity(): Promise<void> {
    return;
  }
}
