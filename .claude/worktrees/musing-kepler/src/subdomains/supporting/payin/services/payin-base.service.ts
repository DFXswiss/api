import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInBaseService extends PayInEvmService {
  constructor(baseService: BaseService) {
    super(baseService);
  }
}
