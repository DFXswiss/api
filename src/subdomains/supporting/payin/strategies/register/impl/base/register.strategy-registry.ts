import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { RegisterStrategy } from './register.strategy';

@Injectable()
export class RegisterStrategyRegistry extends StrategyRegistry<Blockchain, RegisterStrategy> {
  getRegisterStrategy(asset: Asset): RegisterStrategy {
    const strategy = super.get(asset.blockchain);

    if (!strategy) {
      throw new Error(`No RegisterStrategy found. Blockchain: ${asset.blockchain}`);
    }

    return strategy;
  }
}
