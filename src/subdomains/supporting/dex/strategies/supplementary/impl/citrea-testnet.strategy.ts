import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexCitreaTestnetService } from '../../../services/dex-citrea-testnet.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetStrategy extends EvmStrategy {
  constructor(citreaTestnetService: DexCitreaTestnetService) {
    super(citreaTestnetService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }
}