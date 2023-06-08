import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { PrepareStrategy } from './prepare.strategy';

@Injectable()
export class PrepareStrategyRegistry extends StrategyRegistry<PrepareStrategy> {
  getPrepareStrategy(asset: Asset): PrepareStrategy {
    const strategy = super.getStrategy(asset.blockchain);

    if (!strategy) throw new Error(`No PrepareStrategy found. Blockchain: ${asset.blockchain}`);

    return strategy;
  }
}
