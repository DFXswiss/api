import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexBaseService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, baseService: BaseService) {
    super(liquidityOrderRepo, baseService, 'ETH', Blockchain.BASE);
  }
}
