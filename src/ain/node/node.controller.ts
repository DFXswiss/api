import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('node')
export class NodeController {
  private readonly user = 'dfx-api';
  private readonly password = '84r_qmy927jeVbHNC6-CPFKAU02B3c9wS8KaR_LKZUM=';
  private readonly activeNodeUrl = 'https://app-dfx-node-dev.azurewebsites.net';
  private readonly passiveNodeUrl = 'https://app-dfx-node-dev-stg.azurewebsites.net';

  private readonly activeClient: ApiClient;
  private readonly passiveClient: ApiClient;

  constructor() {
    this.activeClient = this.createJellyfishClient(this.activeNodeUrl);
    this.passiveClient = this.createJellyfishClient(this.passiveNodeUrl);
  }

  @Get('active/info')
  @ApiExcludeEndpoint()
  async activeNodeInfo(): Promise<BlockchainInfo> {
    return this.callNode(() => this.activeClient.blockchain.getBlockchainInfo());
  }

  @Get('passive/info')
  @ApiExcludeEndpoint()
  async passiveNodeInfo(): Promise<BlockchainInfo> {
    return this.callNode(() => this.passiveClient.blockchain.getBlockchainInfo());
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

  private createJellyfishClient(url: string): ApiClient {
    return new JsonRpcClient(url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
