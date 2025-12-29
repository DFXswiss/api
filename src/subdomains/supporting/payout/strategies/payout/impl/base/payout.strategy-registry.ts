import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { PayoutStrategy } from './payout.strategy';

interface StrategyRegistryKey {
  blockchain: Blockchain;
  assetType?: AssetType;
}

@Injectable()
export class PayoutStrategyRegistry extends StrategyRegistry<StrategyRegistryKey, PayoutStrategy> {
  getPayoutStrategy(asset: Asset): PayoutStrategy {
    const strategy =
      super.get({ blockchain: asset.blockchain, assetType: asset.type }) ?? super.get({ blockchain: asset.blockchain });

    if (!strategy) {
      throw new Error(`No PayoutStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
