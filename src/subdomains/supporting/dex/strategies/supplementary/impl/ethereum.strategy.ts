import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  constructor(ethereumService: DexEthereumService) {
    super(ethereumService);
  }
}
