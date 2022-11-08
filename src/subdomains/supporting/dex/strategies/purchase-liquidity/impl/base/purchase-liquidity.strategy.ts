import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { NotEnoughLiquidityException } from '../../../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../../../exceptions/price-slippage.exception';
import { LiquidityRequest } from '../../../../interfaces';

export abstract class PurchaseLiquidityStrategy {
  private _feeAsset: Asset;

  constructor(protected readonly notificationService: NotificationService) {}

  async feeAsset(): Promise<Asset> {
    if (!this._feeAsset) {
      this._feeAsset = await this.getFeeAsset();
    }

    return this._feeAsset;
  }

  abstract purchaseLiquidity(request: LiquidityRequest): Promise<void>;
  abstract addPurchaseData(order: LiquidityOrder): Promise<void>;
  protected abstract getFeeAsset(): Promise<Asset>;

  protected async handlePurchaseLiquidityError(e: Error, request: LiquidityRequest): Promise<void> {
    const errorMessage = `Correlation ID: ${request.correlationId}. Context: ${request.context}. ${e.message}`;

    if (e instanceof NotEnoughLiquidityException) {
      const mailRequest = this.createMailRequest(request, errorMessage);

      await this.notificationService.sendMail(mailRequest);
      throw new NotEnoughLiquidityException(errorMessage);
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
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Purchase Liquidity Error', errors: [errorMessage] },
      metadata: {
        context: MailContext.DEX,
        correlationId,
      },
      options: { suppressRecurring: true },
    };
  }
}
