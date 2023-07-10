import { Injectable } from '@nestjs/common';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexOptimismService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, optimismService: OptimismService) {
    super(liquidityOrderRepo, optimismService, Blockchain.OPTIMISM);
  }
}
