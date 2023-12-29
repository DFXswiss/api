import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class PolygonClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }
}
