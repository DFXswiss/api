import { Asset } from '../asset.entity';

export function createDefaultAsset(): Asset {
  return createCustomAsset({});
}

export function createCustomAsset(customValues: Partial<Asset>): Asset {
  const { name, dexName } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Asset();

  entity.name = keys.includes('name') ? name : 'dTSLA';
  entity.dexName = keys.includes('dexName') ? dexName : 'dTSLA';

  return entity;
}
