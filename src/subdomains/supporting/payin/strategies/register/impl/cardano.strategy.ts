import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class CardanoStrategy {
  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  // no automated pay-in processing for Cardano yet
}
