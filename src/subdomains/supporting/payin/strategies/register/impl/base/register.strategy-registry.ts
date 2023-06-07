import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { RegisterStrategy } from './register.strategy';

@Injectable()
export class RegisterStrategyRegistry extends StrategyRegistry<RegisterStrategy> {
  getRegisterStrategy(asset: Asset): RegisterStrategy {
    return super.getStrategy(asset.blockchain);
  }
}
