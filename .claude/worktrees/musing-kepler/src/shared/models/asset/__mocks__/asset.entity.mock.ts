import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from '../asset.entity';

const defaultAsset: Partial<Asset> = {
  name: 'USDT',
  dexName: 'USDT',
  blockchain: Blockchain.ETHEREUM,
  category: AssetCategory.PUBLIC,
  type: AssetType.TOKEN,
  refundEnabled: true,
};

export function createDefaultAsset(): Asset {
  return createCustomAsset({});
}

export function createCustomAsset(customValues: Partial<Asset>): Asset {
  return Object.assign(new Asset(), { ...defaultAsset, ...customValues });
}
