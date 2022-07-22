import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { AssetNotAvailableException } from '../../exceptions/asset-not-available.exception';
import { PurchaseLiquidityRequest } from './purchase-liquidity.facade';

export abstract class PurchaseLiquidityStrategy {
  constructor(protected readonly mailService: MailService) {}

  abstract purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void>;

  protected async handlePurchaseLiquidityError(e: Error, order: LiquidityOrder): Promise<void> {
    const errorMessage = `LiquidityOrder ID: ${order.id}. ${e.message}`;

    if (e instanceof AssetNotAvailableException) {
      await this.mailService.sendErrorMail('Purchase Liquidity Error', [errorMessage]);
    }

    throw new Error(errorMessage);
  }
}
