import { Asset } from 'src/shared/models/asset/asset.entity';

export class DexUtil {
  static parseAssetPair(asset: Asset): [string, string] {
    const assetPair = asset.dexName.split('-');

    if (assetPair.length !== 2) {
      throw new Error(`Provided asset is not a liquidity pool pair. dexName: ${asset.dexName}`);
    }

    return [assetPair[0], assetPair[1]];
  }
}
