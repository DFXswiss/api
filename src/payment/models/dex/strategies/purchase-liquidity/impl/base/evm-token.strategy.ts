import { MailService } from 'src/shared/services/mail.service';
import { LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export class EvmTokenStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService, protected readonly dexEvmService: DexEvmService) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
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
          `Requested ${referenceAsset} liquidity is already available on the wallet. No purchase required, retry checkLiquidity. Context: ${context}. CorrelationID: ${correlationId}`,
        );
      }
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }
}
