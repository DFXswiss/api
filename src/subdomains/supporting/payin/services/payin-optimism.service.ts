import { Injectable } from '@nestjs/common';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInOptimismService extends PayInEvmService {
  constructor(optimismService: OptimismService) {
    super(optimismService);
  }
}
