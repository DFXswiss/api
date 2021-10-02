import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('test')
export class TestController {
  private readonly user = 'dfx-api';
  private readonly password = '84r_qmy927jeVbHNC6-CPFKAU02B3c9wS8KaR_LKZUM=';
  private readonly nodeUrl = 'https://app-dfx-node-dev.azurewebsites.net';

  private readonly client: ApiClient;

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
    } catch (e) {
      // TODO: retries?
      console.log(e);
      throw new ServiceUnavailableException(e);
    }
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.nodeUrl, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
