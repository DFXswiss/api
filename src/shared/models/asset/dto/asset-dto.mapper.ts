import { Config } from 'src/config/config';
import { assetExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Util } from 'src/shared/utils/util';
import { Asset } from '../asset.entity';
import { AssetDetailDto, AssetDto, FeeTier } from './asset.dto';
import { TxMinSpec } from 'src/subdomains/supporting/payment/dto/transaction-helper/tx-spec.dto';

export class AssetDtoMapper {
  static toDto(asset: Asset): AssetDto {
    const dto: AssetDto = {
      id: asset.id,
      name: asset.name,
      chainId: asset.chainId,
      explorerUrl: assetExplorerUrl(asset),
      uniqueName: asset.uniqueName,
      description: asset.description,
      type: asset.type,
      category: asset.category,
      dexName: asset.dexName,
      feeTier: asset.name === 'BTC' ? FeeTier.TIER1 : FeeTier.TIER2,
      comingSoon: asset.comingSoon,
      buyable: asset.buyable,
      sellable: asset.sellable,
      instantBuyable: asset.instantBuyable,
      instantSellable: asset.instantSellable,
      cardBuyable: asset.cardBuyable,
      cardSellable: asset.cardSellable,
      blockchain: asset.blockchain,
      sortOrder: asset.sortOrder,
    };

    return Object.assign(new AssetDto(), dto);
  }

  static toDetailDto(asset: Asset, spec: TxMinSpec): AssetDetailDto {
    const price = asset.approxPriceChf ?? 1;

    return Object.assign(this.toDto(asset), {
      limits: {
        minVolume: Util.roundReadable(spec.minVolume / price, false),
        maxVolume: Util.roundReadable(Config.tradingLimits.yearlyDefault / price, false),
      },
    });
  }
}
