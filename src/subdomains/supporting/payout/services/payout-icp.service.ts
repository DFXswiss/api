import { Injectable } from '@nestjs/common';
import { InternetComputerClient } from 'src/integration/blockchain/icp/icp-client';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutInternetComputerService {
  private readonly client: InternetComputerClient;

  constructor(internetComputerService: InternetComputerService) {
    this.client = internetComputerService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.client.sendTokenFromDex(address, token, amount);
  }

  async getPayoutCompletionData(txHash: string, token?: Asset): Promise<[boolean, number]> {
    const isComplete = await this.client.isTxComplete(txHash);
    if (!isComplete) return [false, 0];

    // ICP tokens use Reverse Gas Model: fee is paid in the token itself
    let payoutFee: number;

    try {
      payoutFee = token
        ? await this.client.getCurrentGasCostForTokenTransaction(token)
        : await this.client.getTxActualFee(txHash);
    } catch {
      payoutFee = await this.client.getCurrentGasCostForCoinTransaction();
    }

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }
}
