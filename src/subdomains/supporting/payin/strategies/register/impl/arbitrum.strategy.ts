import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GenericAlchemyStrategy } from './base/generic-alchemy.strategy';

@Injectable()
export class ArbitrumStrategy extends GenericAlchemyStrategy {
  constructor() {
    super(Blockchain.ARBITRUM);
  }
}
