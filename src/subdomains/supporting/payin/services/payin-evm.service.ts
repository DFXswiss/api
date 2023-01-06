import { Injectable } from '@nestjs/common';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';

@Injectable()
export class PayInEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }
}
