import { Injectable } from '@nestjs/common';
import { IcpTransfer } from 'src/integration/blockchain/icp/dto/icp.dto';
import { InternetComputerClient } from 'src/integration/blockchain/icp/icp-client';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexIcpService {
  private readonly client: InternetComputerClient;

  private readonly nativeCoin = 'ICP';
  private readonly blockchain = Blockchain.INTERNET_COMPUTER;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    internetComputerService: InternetComputerService,
  ) {
    this.client = internetComputerService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.client.sendTokenFromDex(address, token, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.client.isTxComplete(transferTxId);
  }

  async getRecentHistory(blockCount: number): Promise<IcpTransfer[]> {
    const currentBlockHeight = await this.client.getBlockHeight();
    const start = Math.max(0, currentBlockHeight - blockCount);
    const result = await this.client.getTransfers(start, blockCount);
    return result.transfers;
  }

  async getRecentTokenHistory(token: Asset, blockCount: number): Promise<IcpTransfer[]> {
    if (!token.chainId) return [];
    const currentBlockHeight = await this.client.getIcrcBlockHeight(token.chainId);
    const start = Math.max(0, currentBlockHeight - blockCount);
    const result = await this.client.getIcrcTransfers(token.chainId, token.decimals, start, blockCount);
    return result.transfers;
  }

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.client.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTokenAvailability(asset: Asset, inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.client.getTokenBalance(asset);

    return [inputAmount, availableAmount - pendingAmount];
  }

  getNativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(assetName: string): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: assetName, blockchain: this.blockchain },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
