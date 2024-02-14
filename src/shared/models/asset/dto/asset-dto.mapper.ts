import { assetExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Asset } from '../asset.entity';
import { AssetDto } from './asset.dto';

export class AssetDtoMapper {
  static entityToDto(asset: Asset): AssetDto {
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
      comingSoon: asset.comingSoon,
      buyable: asset.buyable,
      sellable: asset.sellable,
      blockchain: asset.blockchain,
      sortOrder: asset.sortOrder,
    };

    return Object.assign(new AssetDto(), dto);
  }

  static entitiesToDto(assets: Asset[]): AssetDto[] {
    return assets
      .filter((asset) => asset.buyable || asset.sellable || asset.comingSoon)
      .map(AssetDtoMapper.entityToDto);
  }
}
