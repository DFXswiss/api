import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  constructor(ethereumService: DexEthereumService) {
    super(ethereumService);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }
}
