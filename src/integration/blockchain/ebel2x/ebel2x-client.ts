import { Dhedge, Network as DhedgeNetwork, Pool as DhedgePool } from '@dhedge/v2-sdk';
import { Config } from 'src/config/config';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';

export class Ebel2xClient extends EvmClient {
  private dhedge: Dhedge;

  constructor(params: EvmClientParams) {
    super(params);

    this.dhedge = new Dhedge(this.wallet, DhedgeNetwork.ARBITRUM);
  }

  async getPool(): Promise<DhedgePool> {
    return this.dhedge.loadPool(Config.blockchain.ebel2x.contractAddress);
  }
}
