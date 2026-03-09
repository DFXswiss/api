import { Injectable } from '@nestjs/common';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutInternetComputerService {
  constructor(private readonly internetComputerService: InternetComputerService) {}

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.internetComputerService.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.internetComputerService.sendTokenFromDex(address, token, amount);
  }

  async getPayoutCompletionData(txHash: string, token?: Asset): Promise<[boolean, number]> {
    const isComplete = await this.internetComputerService.isTxComplete(txHash);
    if (!isComplete) return [false, 0];

    // ICP tokens use Reverse Gas Model: fee is paid in the token itself
    let payoutFee: number;

    try {
      payoutFee = token
        ? await this.internetComputerService.getCurrentGasCostForTokenTransaction(token)
        : await this.internetComputerService.getTxActualFee(txHash);
    } catch {
      payoutFee = await this.internetComputerService.getCurrentGasCostForCoinTransaction();
    }

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.internetComputerService.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.internetComputerService.getCurrentGasCostForTokenTransaction(token);
  }
}
