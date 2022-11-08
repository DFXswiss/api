import { Injectable } from '@nestjs/common';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './dex-evm.service';

@Injectable()
export class DexBscService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, bscService: BscService) {
    super(liquidityOrderRepo, bscService, 'BNB', Blockchain.BINANCE_SMART_CHAIN);
  }
}
