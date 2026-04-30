import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscStrategy extends EvmStrategy {
  constructor(bscService: DexBscService) {
    super(bscService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
  }
}
