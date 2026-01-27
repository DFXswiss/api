import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CitreaBaseClient } from '../shared/evm/citrea-base-client';
import { EvmClientParams } from '../shared/evm/evm-client';

export class CitreaClient extends CitreaBaseClient {
  protected override readonly logger = new DfxLogger(CitreaClient);

  constructor(params: EvmClientParams) {
    super(params);
  }
}
