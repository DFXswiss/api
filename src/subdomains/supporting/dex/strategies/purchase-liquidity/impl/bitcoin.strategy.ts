import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PurchaseLiquidityRequest } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';

@Injectable()
export class BitcoinStrategy extends PurchaseLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    notificationService: NotificationService,
    private readonly dexBtcService: DexBitcoinService,
  ) {
    super(notificationService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const { referenceAsset, referenceAmount, context, correlationId } = request;
    try {
      // should always throw, even if there is amount, additional check is done for API consistency and sending mail
      const amount = await this.dexBtcService.checkAvailableTargetLiquidity(referenceAmount);

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

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBtcCoin();
  }
}
