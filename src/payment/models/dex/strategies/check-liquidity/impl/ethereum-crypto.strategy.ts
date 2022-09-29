import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCryptoStrategy } from './base/evm-crypto.strategy';

@Injectable()
export class EthereumCryptoStrategy extends EvmCryptoStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
