import { MailService } from 'src/shared/services/mail.service';
import { LiquidityRequest } from '../../../interfaces';
import { DexEvmService } from '../../../services/dex-evm.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export class PurchaseLiquidityEvmTokenStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService, protected readonly dexEvmService: DexEvmService) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    return;
  }
}
