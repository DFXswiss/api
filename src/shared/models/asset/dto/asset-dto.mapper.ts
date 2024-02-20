import { Config } from 'src/config/config';
import { assetExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Util } from 'src/shared/utils/util';
import { TxSpec } from 'src/subdomains/supporting/payment/dto/tx-spec.dto';
import { Asset } from '../asset.entity';
import { AssetDetailDto, AssetDto, FeeTier } from './asset.dto';

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
      blockchain: asset.blockchain,
      sortOrder: asset.sortOrder,
    };

    return Object.assign(new AssetDto(), dto);
  }
  static toDetailDto(asset: Asset, spec: TxSpec): AssetDetailDto {
    const price = asset.approxPriceUsd ?? 1;

    return Object.assign(this.toDto(asset), {
      limits: {
        minVolume: Util.roundByPrecision(spec.minVolume / price, 5),
        maxVolume: Util.roundByPrecision(Config.defaultTradingLimit / price, 5),
      },
    });
  }
}
