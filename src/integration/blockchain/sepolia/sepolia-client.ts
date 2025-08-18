import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class SepoliaClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }
}