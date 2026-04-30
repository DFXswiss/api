import { Injectable } from '@nestjs/common';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutCitreaService extends PayoutEvmService {
  constructor(citreaService: CitreaService) {
    super(citreaService);
  }
}
