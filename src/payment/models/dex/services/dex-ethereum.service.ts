import { Injectable } from '@nestjs/common';
import { EthereumService } from 'src/blockchain/ethereum/ethereum.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEVMService } from './dex-evm.service';

@Injectable()
export class DexEthereumService extends DexEVMService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, ethereumService: EthereumService) {
    super(liquidityOrderRepo, ethereumService);
  }
}
