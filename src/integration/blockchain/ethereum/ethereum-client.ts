import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }
}
