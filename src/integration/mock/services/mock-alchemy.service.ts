import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class MockAlchemyService {
  private readonly logger = new DfxLogger(MockAlchemyService);

  async getBalance(address: string, _network?: string): Promise<string> {
    this.logger.verbose(`Mock: getBalance for ${address}`);
    return '0';
  }

  async getTokenBalances(address: string, _network?: string): Promise<any[]> {
    this.logger.verbose(`Mock: getTokenBalances for ${address}`);
    return [];
  }

  async getTransactionReceipt(txHash: string, _network?: string): Promise<any> {
    this.logger.verbose(`Mock: getTransactionReceipt for ${txHash}`);
    return {
      transactionHash: txHash,
      status: 1,
      blockNumber: 12345678,
      gasUsed: '21000',
    };
  }

  async getBlockNumber(_network?: string): Promise<number> {
    this.logger.verbose('Mock: getBlockNumber');
    return 12345678;
  }

  async getGasPrice(_network?: string): Promise<string> {
    this.logger.verbose('Mock: getGasPrice');
    return '20000000000'; // 20 gwei
  }

  async estimateGas(_tx: any, _network?: string): Promise<string> {
    this.logger.verbose('Mock: estimateGas');
    return '21000';
  }

  async sendTransaction(_signedTx: string, _network?: string): Promise<string> {
    const mockTxHash = `0x${'0'.repeat(64)}`;
    this.logger.verbose(`Mock: sendTransaction → ${mockTxHash}`);
    return mockTxHash;
  }

  async call(_tx: any, _network?: string): Promise<string> {
    this.logger.verbose('Mock: call');
    return '0x';
  }
}
