import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';
import { PayoutTxStatus } from '../interfaces';

export abstract class PayoutEvmService {
  private readonly client: EvmClient;

  constructor(service: EvmService) {
    this.client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number, nonce?: number): Promise<string> {
    try {
      return await this.client.sendNativeCoinFromDex(address, amount, nonce);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async sendToken(address: string, tokenName: Asset, amount: number, nonce?: number): Promise<string> {
    try {
      return await this.client.sendTokenFromDex(address, tokenName, amount, nonce);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async getPayoutCompletionData(txHash: string): Promise<PayoutTxStatus> {
    const receipt = await this.client.getTxReceipt(txHash);
    if (!receipt || receipt.confirmations <= 0) return { state: 'pending' };

    if (receipt.status === 1) {
      const fee = await this.client.getTxActualFee(txHash);
      // §2.3 exactness (#4287 stage 3): the EXACT gas-fee wei alongside the float (booked verbatim on the network-fee
      // leg); any capture error -> null -> the ledger derives from the float (fail-open).
      const feeBaseUnits = await this.feeBaseUnits(txHash);
      return { state: 'complete', fee, feeBaseUnits };
    }

    const tx = await this.client.getTx(txHash);
    const isOutOfGas = tx ? receipt.gasUsed.eq(tx.gasLimit) : false;
    return { state: 'failed', isOutOfGas };
  }

  // fail-open capture of the exact on-chain gas-fee wei (issue #4287 stage 3): a capture error must never wedge payout
  // completion, so it degrades to null and the ledger then derives the fee base units from the float.
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

  async getTxNonce(txHash: string): Promise<number> {
    return this.client.getTxNonce(txHash);
  }

  async isTxExpired(txHash: string): Promise<boolean> {
    if (!(await this.isRpcSynced())) return false;

    const tx = await this.client.getTx(txHash);
    return tx === null;
  }

  private async isRpcSynced(maxAgeSeconds = 300): Promise<boolean> {
    const blockTimestamp = await this.client.getLatestBlockTimestamp();
    const blockAge = Date.now() / 1000 - blockTimestamp;
    return blockAge < maxAgeSeconds;
  }
}
