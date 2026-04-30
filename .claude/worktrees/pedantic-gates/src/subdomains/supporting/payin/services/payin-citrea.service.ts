import { Injectable } from '@nestjs/common';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInCitreaService extends PayInEvmService {
  constructor(citreaService: CitreaService) {
    super(citreaService);
  }
}
