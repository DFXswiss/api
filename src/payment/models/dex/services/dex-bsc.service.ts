import { Injectable } from '@nestjs/common';
import { BSCService } from 'src/blockchain/bsc/bsc.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEVMService } from './dex-evm.service';

@Injectable()
export class DexBSCService extends DexEVMService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, bscService: BSCService) {
    super(liquidityOrderRepo, bscService, 'BNB', Blockchain.BINANCE_SMART_CHAIN);
  }
}
