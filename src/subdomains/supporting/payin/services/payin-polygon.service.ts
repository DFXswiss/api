import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInEvmProxyService } from './base/payin-evm-proxy.service';
import { PayInEvmFactory } from './payin-evm.factory';

@Injectable()
export class PayInPolygonService extends PayInEvmProxyService {
  protected readonly blockchain = Blockchain.POLYGON;

  constructor(factory: PayInEvmFactory) {
    super(factory);
  }
}
