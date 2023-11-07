import { Injectable } from '@nestjs/common';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInBscService extends PayInEvmService {
  constructor(bscService: BscService, alchemyService: AlchemyService) {
    super(bscService, alchemyService);
  }
}
