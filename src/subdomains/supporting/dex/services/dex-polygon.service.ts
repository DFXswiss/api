import { Injectable } from '@nestjs/common';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DexEvmService } from './base/dex-evm.service';

@Injectable()
export class DexPolygonService extends DexEvmService {
  constructor(liquidityOrderRepo: LiquidityOrderRepository, polygonService: PolygonService) {
    super(liquidityOrderRepo, polygonService, 'MATIC', Blockchain.POLYGON);
  }
}
