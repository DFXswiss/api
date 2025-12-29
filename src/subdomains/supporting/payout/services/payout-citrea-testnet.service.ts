import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutCitreaTestnetService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.CITREA_TESTNET;

  constructor(factory: PayoutEvmFactory) {
    super(factory);
  }
}