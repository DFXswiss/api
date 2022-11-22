import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { PurchaseLiquidityStrategyAlias } from '../../purchase-liquidity.facade';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export abstract class EvmTokenStrategy extends PurchaseLiquidityStrategy {
  constructor(
    notificationService: NotificationService,
    protected readonly dexEvmService: DexEvmService,
    name: PurchaseLiquidityStrategyAlias,
  ) {
    super(notificationService, name);
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, context, correlationId } = request;

    try {
      // should always throw, even if there is amount, additional check is done for API consistency and sending mail
      const amount = await this.dexEvmService.getAndCheckTokenAvailability(
        referenceAsset,
        referenceAmount,
        targetAsset,
      );

      if (amount) {
        throw new Error(
          `Requested ${referenceAsset.dexName} liquidity is already available on the wallet. No purchase required, retry checkLiquidity. Context: ${context}. CorrelationID: ${correlationId}`,
        );
      }
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  addPurchaseData(): Promise<void> {
    // liquidity purchase not applicable
    return;
  }
}
