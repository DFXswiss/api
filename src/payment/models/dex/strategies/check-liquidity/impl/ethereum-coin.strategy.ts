import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
