import { Injectable } from '@nestjs/common';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInEthereumService extends PayInEvmService {
  constructor(ethereumService: EthereumService, alchemyService: AlchemyService) {
    super(ethereumService, alchemyService);
  }
}
