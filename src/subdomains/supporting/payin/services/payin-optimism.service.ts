import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInEvmProxyService } from './base/payin-evm-proxy.service';
import { PayInEvmFactory } from './payin-evm.factory';

@Injectable()
export class PayInOptimismService extends PayInEvmProxyService {
  protected readonly blockchain = Blockchain.OPTIMISM;

  constructor(factory: PayInEvmFactory) {
    super(factory);
  }
}
