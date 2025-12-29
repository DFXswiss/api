import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { SendStrategy } from './send.strategy';

interface StrategyRegistryKey {
  blockchain: Blockchain;
  assetType?: AssetType;
}

@Injectable()
export class SendStrategyRegistry extends StrategyRegistry<StrategyRegistryKey, SendStrategy> {
  getSendStrategy(asset: Asset): SendStrategy {
    const strategy =
      super.get({ blockchain: asset.blockchain, assetType: asset.type }) ?? super.get({ blockchain: asset.blockchain });

    if (!strategy) {
      throw new Error(`No SendStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
