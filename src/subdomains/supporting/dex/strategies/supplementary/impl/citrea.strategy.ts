import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexCitreaService } from '../../../services/dex-citrea.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaStrategy extends EvmStrategy {
  constructor(citreaService: DexCitreaService) {
    super(citreaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
  }
}
