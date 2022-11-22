import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { NotEnoughLiquidityException } from '../../../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../../../exceptions/price-slippage.exception';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategyAlias } from '../../purchase-liquidity.facade';

export abstract class PurchaseLiquidityStrategy {
  private _name: PurchaseLiquidityStrategyAlias;
  private _feeAsset: Asset;

  constructor(protected readonly notificationService: NotificationService, name: PurchaseLiquidityStrategyAlias) {
    this._name = name;
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void>;
  abstract addPurchaseData(order: LiquidityOrder): Promise<void>;
  protected abstract getFeeAsset(): Promise<Asset>;

  protected async handlePurchaseLiquidityError(e: Error, request: PurchaseLiquidityRequest): Promise<void> {
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

  private createMailRequest(liquidityRequest: PurchaseLiquidityRequest, errorMessage: string): MailRequest {
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

  //*** GETTERS ***//

  get name(): string {
    return this._name;
  }
}
