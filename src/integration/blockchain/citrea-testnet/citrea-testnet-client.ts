import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CitreaBaseClient } from '../shared/evm/citrea-base-client';
import { EvmClientParams } from '../shared/evm/evm-client';

export class CitreaTestnetClient extends CitreaBaseClient {
  protected override readonly logger = new DfxLogger(CitreaTestnetClient);

  constructor(params: EvmClientParams) {
    super(params);
  }
}
