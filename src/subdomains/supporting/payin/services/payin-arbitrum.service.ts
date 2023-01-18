import { Injectable } from '@nestjs/common';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInArbitrumService extends PayInEvmService {
  constructor(arbitrumService: ArbitrumService) {
    super(arbitrumService);
  }
}
