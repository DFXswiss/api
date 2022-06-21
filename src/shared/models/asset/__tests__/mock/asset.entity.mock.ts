import { Asset } from '../../asset.entity';

export function createDefaultAsset(): Asset {
  return createCustomAsset({});
}

export function createCustomAsset(customValues: Partial<Asset>): Asset {
  const { name } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Asset();

  entity.name = keys.includes('name') ? name : 'dTSLA';

  return entity;
}
