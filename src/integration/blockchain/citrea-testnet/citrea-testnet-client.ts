import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class CitreaTestnetClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }
}