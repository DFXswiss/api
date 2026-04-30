import { Injectable } from '@nestjs/common';
import { CitreaTestnetService } from 'src/integration/blockchain/citrea-testnet/citrea-testnet.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInCitreaTestnetService extends PayInEvmService {
  constructor(citreaTestnetService: CitreaTestnetService) {
    super(citreaTestnetService);
  }
}
