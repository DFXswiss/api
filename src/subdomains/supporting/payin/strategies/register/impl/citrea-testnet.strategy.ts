import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { CitreaBaseStrategy } from './base/citrea.strategy';

@Injectable()
export class CitreaTestnetStrategy extends CitreaBaseStrategy {
  constructor(
    payInCitreaTestnetService: PayInCitreaTestnetService,
    transactionRequestService: TransactionRequestService,
  ) {
    super(payInCitreaTestnetService, transactionRequestService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  protected getOwnAddresses(): string[] {
    return [Config.blockchain.citreaTestnet.citreaTestnetWalletAddress];
  }
}
