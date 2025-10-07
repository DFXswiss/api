import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexSepoliaService } from '../../../services/dex-sepolia.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class SepoliaStrategy extends EvmStrategy {
  constructor(sepoliaService: DexSepoliaService) {
    super(sepoliaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.SEPOLIA;
  }
}