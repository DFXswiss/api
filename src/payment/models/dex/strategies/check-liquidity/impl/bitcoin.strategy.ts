import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class BitcoinStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly assetService: AssetService, private readonly dexBtcService: DexBitcoinService) {
    super();
  }

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAmount: bitcoinAmount } = request;

    const [targetAmount, availableAmount] = await this.dexBtcService.checkAvailableTargetLiquidity(bitcoinAmount);

    return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
      request,
      targetAmount,
      availableAmount,
      await this.feeAsset(),
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'BTC', blockchain: Blockchain.BITCOIN, type: AssetType.COIN });
  }
}
