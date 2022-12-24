import { Injectable } from '@nestjs/common';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutOptimismService extends PayoutEvmService {
  constructor(optimismService: OptimismService) {
    super(optimismService);
  }
}
