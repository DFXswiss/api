import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { SendStrategy } from './send.strategy';

@Injectable()
export class SendStrategyRegistry extends StrategyRegistry<SendStrategy> {
  getSendStrategy(asset: Asset): SendStrategy {
    const strategy = super.getStrategy(asset.blockchain, asset.type);

    if (!strategy) throw new Error(`No SendStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);

    return strategy;
  }
}
