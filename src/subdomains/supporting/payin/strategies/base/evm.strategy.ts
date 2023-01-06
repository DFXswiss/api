import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInEvmService } from '../../services/payin-evm.service';
import { PayInStrategy } from './payin.strategy';

export abstract class EvmStrategy extends PayInStrategy {
  constructor(protected readonly payInEvmService: PayInEvmService) {
    super();
  }

  //*** HELPER METHODS ***//

  protected async processNewPayInEntries(): Promise<void> {
    console.log('TBD');
  }

  //*** HELPER METHODS ***//

  protected async getCoinBalance(address: BlockchainAddress): Promise<number> {
    throw new Error('Method not implemented.');
  }

  protected async getTokenBalance(asset: Asset, address: BlockchainAddress): Promise<number> {
    throw new Error('Method not implemented.');
  }
}
