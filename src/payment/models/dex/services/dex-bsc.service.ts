import { Injectable } from '@nestjs/common';
import { BSCClient } from 'src/blockchain/bsc/bsc-client';
import { BSCService } from 'src/blockchain/bsc/bsc.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEVMService } from './dex-evm.service';

@Injectable()
export class DexBSCService extends DexEVMService<BSCClient> {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, bscService: BSCService) {
    super(liquidityOrderRepo, bscService);
  }
}
