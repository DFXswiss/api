import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SolanaTransactionDto } from 'src/integration/blockchain/solana/dto/solana.dto';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexSolanaService {
  private readonly solanaClient: SolanaClient;

  private readonly nativeCoin = 'SOL';
  private readonly blockchain = Blockchain.SOLANA;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, solanaService: SolanaService) {
    this.solanaClient = solanaService.getDefaultClient();
  }

  async sendTransfer(address: string, amount: number): Promise<string> {
    return this.solanaClient.sendNativeCoinFromDex(address, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.solanaClient.isTxComplete(transferTxId);
  }

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.solanaClient.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTokenAvailability(asset: Asset, inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.solanaClient.getTokenBalance(asset);

    return [inputAmount, availableAmount - pendingAmount];
  }

  async getRecentHistory(txCount: number): Promise<SolanaTransactionDto[]> {
    return this.solanaClient.getHistory(txCount);
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
