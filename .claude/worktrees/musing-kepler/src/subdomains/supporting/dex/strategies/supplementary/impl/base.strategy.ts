import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexBaseService } from '../../../services/dex-base.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BaseStrategy extends EvmStrategy {
  constructor(baseService: DexBaseService) {
    super(baseService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }
}
