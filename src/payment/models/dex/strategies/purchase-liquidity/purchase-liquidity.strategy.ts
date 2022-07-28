import { MailService } from 'src/shared/services/mail.service';
import { NotEnoughLiquidityException } from '../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../exceptions/price-slippage.exception';
import { LiquidityRequest } from '../../services/dex.service';

export abstract class PurchaseLiquidityStrategy {
  constructor(protected readonly mailService: MailService) {}

  abstract purchaseLiquidity(request: LiquidityRequest): Promise<void>;

  protected async handlePurchaseLiquidityError(e: Error, request: LiquidityRequest): Promise<void> {
    const errorMessage = `Correlation ID: ${request.correlationId}. Context: ${request.context}. ${e.message}`;

    if (e instanceof NotEnoughLiquidityException) {
      await this.mailService.sendErrorMail('Purchase Liquidity Error', [errorMessage]);
    }

    if (e instanceof PriceSlippageException) {
      throw new PriceSlippageException(errorMessage);
    }

    throw new Error(errorMessage);
  }
}
