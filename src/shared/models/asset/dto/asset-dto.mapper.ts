import { Asset } from '../asset.entity';
import { AssetDto } from './asset.dto';

export class AssetDtoMapper {
  static entityToDto(asset: Asset): AssetDto {
    const dto: AssetDto = {
      id: asset.id,
      name: asset.name,
      chainId: asset.chainId,
      uniqueName: asset.uniqueName,
      description: asset.description,
      type: asset.type,
      category: asset.category,
      dexName: asset.dexName,
      feeTier: asset.feeTier,
      comingSoon: asset.comingSoon,
      buyable: asset.buyable,
      sellable: asset.sellable,
      blockchain: asset.blockchain,
      sortOrder: asset.sortOrder,
    };

    return Object.assign(new AssetDto(), dto);
  }

  static entitiesToDto(assets: Asset[]): AssetDto[] {
    return assets.map(AssetDtoMapper.entityToDto);
  }
}
