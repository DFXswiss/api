import { MailContext, MailType } from 'src/notification/enums';
import { NotificationService } from 'src/notification/services/notification.service';
import { NotEnoughLiquidityException } from '../../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../../exceptions/price-slippage.exception';
import { LiquidityRequest } from '../../../interfaces';

export abstract class PurchaseLiquidityStrategy {
  constructor(protected readonly notificationService: NotificationService) {}

  abstract purchaseLiquidity(request: LiquidityRequest): Promise<void>;

  protected async handlePurchaseLiquidityError(e: Error, request: LiquidityRequest): Promise<void> {
    const errorMessage = `Correlation ID: ${request.correlationId}. Context: ${request.context}. ${e.message}`;

    if (e instanceof NotEnoughLiquidityException) {
      const correlationId = `${request.context}&${request.correlationId}`;
      console.log('TRY notificationService.sendMail DEX');
      await this.notificationService.sendMail({
        context: MailContext.DEX,
        correlationId,
        type: MailType.ERROR,
        data: { subject: 'Purchase Liquidity Error', errors: [errorMessage] },
        options: { suppressRecurring: true },
      });
    }

    if (e instanceof PriceSlippageException) {
      throw new PriceSlippageException(errorMessage);
    }

    throw new Error(errorMessage);
  }
}
