import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { SupplementaryStrategy } from './supplementary.strategy';

export class SupplementaryStrategyRegistry extends StrategyRegistry<Blockchain, SupplementaryStrategy> {
  getSupplementaryStrategyByAsset(asset: Asset): SupplementaryStrategy {
    return this.getSupplementaryStrategyByBlockchain(asset.blockchain);
  }

  getSupplementaryStrategyByBlockchain(blockchain: Blockchain): SupplementaryStrategy {
    const strategy = super.getStrategy(blockchain);

    if (!strategy) {
      throw new Error(`No SupplementaryStrategy found. Blockchain: ${blockchain}`);
    }

    return strategy;
  }
}
