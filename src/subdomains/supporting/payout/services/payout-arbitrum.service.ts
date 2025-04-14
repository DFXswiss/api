import { Injectable } from '@nestjs/common';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutArbitrumService extends PayoutEvmService {
  constructor(arbitrumService: ArbitrumService) {
    super(arbitrumService);
  }
}
