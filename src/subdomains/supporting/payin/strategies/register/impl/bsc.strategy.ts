import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GenericAlchemyStrategy } from './base/generic-alchemy.strategy';

@Injectable()
export class BscStrategy extends GenericAlchemyStrategy {
  constructor() {
    super(Blockchain.BINANCE_SMART_CHAIN);
  }
}
