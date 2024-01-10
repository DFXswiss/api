import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class PolygonStrategy extends EvmStrategy {
  constructor(polygonService: DexPolygonService) {
    super(polygonService);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }
}
