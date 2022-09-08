import { MailService } from 'src/shared/services/mail.service';
import { LiquidityRequest } from '../../../interfaces';
import { DexEVMService } from '../../../services/dex-evm.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export class PurchaseLiquidityEVMStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService, protected readonly dexEVMService: DexEVMService) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { referenceAsset, referenceAmount, context, correlationId } = request;

    // should always throw, even if there is amount, additional check is done for API consistency and sending mail
    if (referenceAsset === this.dexEVMService._nativeCoin) {
      const amount = await this.dexEVMService.checkCoinAvailability(referenceAmount);

      if (amount) {
        throw new Error(
          `Requested ${referenceAsset} liquidity is already available on the wallet. No purchase required, retry checkLiquidity. Context: ${context}. CorrelationID: ${correlationId}`,
        );
      }
    }

    // throw by default, only native coin trading enabled
    throw new Error(
      `Only native coins are supported by EVM PurchaseLiquidity strategy. Provided reference asset: ${referenceAsset} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }
}
