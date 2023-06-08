import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { PayoutStrategy } from './payout.strategy';

@Injectable()
export class PayoutStrategyRegistry extends StrategyRegistry<PayoutStrategy> {
  getPayoutStrategy(asset: Asset): PayoutStrategy {
    const strategy = super.getStrategy(asset.blockchain, asset.type);

    if (!strategy)
      throw new Error(`No PayoutStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);

    return strategy;
  }
}
