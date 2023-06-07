import { Blockchain as BlockchainType } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';

export abstract class StrategyRegistry<T> {
  private registry: Map<string, T> = new Map();

  addStrategy(strategy: T, blockchainType: BlockchainType, assetType?: AssetType) {
    this.registry.set(this.getKey(blockchainType, assetType), strategy);
  }

  removeStrategy(blockchainType: BlockchainType, assetType?: AssetType) {
    this.registry.delete(this.getKey(blockchainType, assetType));
  }

  getStrategy(blockchainType: BlockchainType, assetType?: AssetType): T {
    return this.registry.get(this.getKey(blockchainType, assetType));
  }

  private getKey(blockchainType: BlockchainType, assetType?: AssetType): string {
    return JSON.stringify({ blockchainType: blockchainType, assetType: assetType });
  }
}
