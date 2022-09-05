import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from '../asset.entity';

export function createDefaultAsset(): Asset {
  return createCustomAsset({});
}

export function createCustomAsset(customValues: Partial<Asset>): Asset {
  const { name, dexName, blockchain } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Asset();

  entity.name = keys.includes('name') ? name : 'dTSLA';
  entity.dexName = keys.includes('dexName') ? dexName : 'dTSLA';
  entity.blockchain = keys.includes('blockchain') ? blockchain : Blockchain.DEFICHAIN;

  return entity;
}
