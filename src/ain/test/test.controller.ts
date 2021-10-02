import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('test')
export class TestController {
  private user = 'dfx-api';
  private password = '84r_qmy927jeVbHNC6-CPFKAU02B3c9wS8KaR_LKZUM=';
  private nodeUrl = 'https://app-dfx-node-dev.azurewebsites.net';

  private client: ApiClient;

  constructor() {
    this.client = this.createJellyfishClient();
  }

  @Get()
  @ApiExcludeEndpoint()
  async test(): Promise<BlockchainInfo> {
    return this.callNode(() => this.client.blockchain.getBlockchainInfo());
  }

  private async callNode<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch(e) {
      // TODO: retries?
      console.log(e);
      throw new ServiceUnavailableException(e);
    }
  }

  private createJellyfishClient(): ApiClient {
    const passwordHash = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return new JsonRpcClient(this.nodeUrl, { headers: { Authorization: 'Basic ' + passwordHash } });
  }
}
