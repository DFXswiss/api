import { Injectable } from '@nestjs/common';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexArbitrumService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, arbitrumService: ArbitrumService) {
    super(liquidityOrderRepo, arbitrumService, Blockchain.ARBITRUM);
  }
}
