import { Injectable } from '@nestjs/common';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInEthereumService extends PayInEvmService {
  constructor(ethereumService: EthereumService) {
    super(ethereumService);
  }
}
