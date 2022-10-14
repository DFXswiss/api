import { MailService } from 'src/shared/services/mail.service';
import { LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export class EvmCoinStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService, protected readonly dexEvmService: DexEvmService) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { referenceAsset, referenceAmount, context, correlationId } = request;

    try {
      // should always throw, even if there is amount, additional check is done for API consistency and sending mail
      if (referenceAsset === this.dexEvmService._nativeCoin) {
        const amount = await this.dexEvmService.checkNativeCoinAvailability(referenceAmount);

        if (amount) {
          throw new Error(
            `Requested ${referenceAsset} liquidity is already available on the wallet. No purchase required, retry checkLiquidity. Context: ${context}. CorrelationID: ${correlationId}`,
          );
        }
      }

      // throw by default, only native coin is enabled as a referenceAsset
      throw new Error(
        `Only native coin reference is supported by EVM PurchaseLiquidity strategy. Provided reference asset: ${referenceAsset} Context: ${context}. CorrelationID: ${correlationId}`,
      );
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }
}
