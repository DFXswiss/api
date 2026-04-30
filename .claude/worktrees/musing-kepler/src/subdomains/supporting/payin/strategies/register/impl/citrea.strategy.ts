import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { PayInCitreaService } from '../../../services/payin-citrea.service';
import { CitreaBaseStrategy } from './base/citrea.strategy';

@Injectable()
export class CitreaStrategy extends CitreaBaseStrategy {
  constructor(payInCitreaService: PayInCitreaService, transactionRequestService: TransactionRequestService) {
    super(payInCitreaService, transactionRequestService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
  }

  protected getOwnAddresses(): string[] {
    return [Config.blockchain.citrea.citreaWalletAddress];
  }
}
