import { MailContext, MailType } from 'src/notification/enums';
import { MailRequest } from 'src/notification/interfaces';
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
      const mailRequest = this.createMailRequest(request, errorMessage);

      await this.notificationService.sendMail(mailRequest);
    }

    if (e instanceof PriceSlippageException) {
      throw new PriceSlippageException(errorMessage);
    }

    throw new Error(errorMessage);
  }

  //*** HELPER METHODS ***//

  private createMailRequest(liquidityRequest: LiquidityRequest, errorMessage: string): MailRequest {
    const correlationId = `PurchaseLiquidity&${liquidityRequest.context}&${liquidityRequest.correlationId}`;

    return {
      type: MailType.ERROR,
      input: { subject: 'Purchase Liquidity Error', errors: [errorMessage] },
      metadata: {
        context: MailContext.DEX,
        correlationId,
      },
      options: { suppressRecurring: true },
    };
  }
}
