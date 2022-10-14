import { Injectable } from '@nestjs/common';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';
import { LiquidityRequest } from '../../../interfaces';
import { MailService } from 'src/shared/services/mail.service';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';

@Injectable()
export class BitcoinStrategy extends PurchaseLiquidityStrategy {
  constructor(mailService: MailService, private readonly dexBtcService: DexBitcoinService) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { referenceAsset, referenceAmount, context, correlationId } = request;
    try {
      // should always throw, even if there is amount, additional check is done for API consistency and sending mail
      const amount = await this.dexBtcService.checkAvailableTargetLiquidity(referenceAmount);

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
