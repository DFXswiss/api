import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutArbitrumService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.ARBITRUM;

  constructor(factory: PayoutEvmFactory) {
    super(factory);
  }
}
