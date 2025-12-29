import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AlchemyStrategy } from './base/alchemy.strategy';

@Injectable()
export class BaseStrategy extends AlchemyStrategy {
  protected readonly logger = new DfxLogger(BaseStrategy);

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.base.baseWalletAddress];
  }
}
