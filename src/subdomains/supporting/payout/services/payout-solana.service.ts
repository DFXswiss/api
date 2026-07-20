import { Injectable } from '@nestjs/common';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

@Injectable()
export class PayoutSolanaService {
  private readonly client: SolanaClient;

  constructor(solanaService: SolanaService) {
    this.client = solanaService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    try {
      return await this.client.sendNativeCoinFromDex(address, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    try {
      return await this.client.sendTokenFromDex(address, token, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number, bigint | null]> {
    const isComplete = await this.client.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.client.getTxActualFee(txHash) : 0;
    // §2.3 exactness (issue #4287): the EXACT fee lamports alongside the float; fail-open null on any capture error so a
    // fee-capture hiccup never blocks payout completion (the ledger then derives the fee leg from the float).
    const feeBaseUnits = isComplete ? await this.feeBaseUnits(txHash) : null;

    return [isComplete, payoutFee, feeBaseUnits];
  }

  private async feeBaseUnits(txHash: string): Promise<bigint | null> {
    try {
      return await this.client.getTxActualFeeBaseUnits(txHash);
    } catch {
      return null;
    }
  }
  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }
}
