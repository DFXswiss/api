import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutBscService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.BINANCE_SMART_CHAIN;

  constructor(factory: PayoutEvmFactory) {
    super(factory);
  }
}
