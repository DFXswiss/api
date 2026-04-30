import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export abstract class NoPurchaseStrategy extends PurchaseLiquidityStrategy {
  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const { targetAsset, context, correlationId } = request;

    throw new Error(
      `Purchase for ${targetAsset.uniqueName} is not available (context: ${context}, correlationID: ${correlationId})`,
    );
  }

  addPurchaseData(): Promise<void> {
    // liquidity purchase not applicable
    return;
  }
}
