import { Injectable } from '@nestjs/common';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexSepoliaService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, sepoliaService: SepoliaService) {
    super(liquidityOrderRepo, sepoliaService, 'ETH', Blockchain.SEPOLIA);
  }
}
