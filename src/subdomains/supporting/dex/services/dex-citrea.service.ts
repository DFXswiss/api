import { Injectable } from '@nestjs/common';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexCitreaService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, citreaService: CitreaService) {
    super(liquidityOrderRepo, citreaService, 'cBTC', Blockchain.CITREA);
  }
}
