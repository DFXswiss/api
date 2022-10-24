import { Injectable } from '@nestjs/common';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';
import { LiquidityRequest } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { NotificationService } from 'src/notification/services/notification.service';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class BitcoinStrategy extends PurchaseLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    private readonly dexBtcService: DexBitcoinService,
  ) {
    super(notificationService);
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

  addPurchaseData(order: LiquidityOrder): Promise<void> {
    throw new Error('Method not implemented.');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'BTC', blockchain: Blockchain.BITCOIN });
  }
}
