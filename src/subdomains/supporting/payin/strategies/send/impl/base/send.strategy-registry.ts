import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { SendStrategy } from './send.strategy';

@Injectable()
export class SendStrategyRegistry extends StrategyRegistry<SendStrategy> {
  getSendStrategy(asset: Asset): SendStrategy {
    return super.getStrategy(asset.blockchain, asset.type);
  }
}
