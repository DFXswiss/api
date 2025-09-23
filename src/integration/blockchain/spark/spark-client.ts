import { SparkWallet } from '@buildonspark/spark-sdk';
import { Injectable } from '@nestjs/common';
import { Currency } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncField } from 'src/shared/utils/async-field';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';

export interface SparkTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
}

export interface SparkNodeInfo {
  version: string;
  testnet: boolean;
  connections: number;
}

export interface SparkFeeEstimate {
  feeRate: number;
  blocks: number;
}

@Injectable()
export class SparkClient extends BlockchainClient {
  private readonly logger = new DfxLogger(SparkClient);

  private readonly wallet: AsyncField<SparkWallet>;
  private readonly cachedAddress: AsyncField<string>;

  constructor() {
    super();

    this.wallet = new AsyncField(() =>
      SparkWallet.initialize({
        mnemonicOrSeed: GetConfig().blockchain.spark.sparkWalletSeed,
        accountNumber: 0,
        options: { network: 'MAINNET' },
      }).then((r) => r.wallet),
    );
    this.cachedAddress = new AsyncField(() => this.wallet.then((w) => w.getSparkAddress()), true);
  }

  get walletAddress(): string {
    return this.cachedAddress.value;
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    try {
      const wallet = await this.wallet;

      const amountSats = Math.round(amount * 1e8);

      const result = await wallet.transfer({
        amountSats,
        receiverSparkAddress: to,
      });

      return { txid: result.id, fee: 0 };
    } catch (error) {
      this.logger.error('Failed to send Spark transaction:', error);
      throw error;
    }
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    const wallet = await this.wallet;
    const transfer = await wallet.getTransfer(txId);

    if (!transfer) {
      throw new Error(`Transaction ${txId} not found`);
    }

    // SPARK uses final confirmation - either confirmed (1) or not (0)
    const isConfirmed = transfer.status === 'TRANSFER_STATUS_COMPLETED';

    return {
      txid: transfer.id,
      blockhash: isConfirmed ? 'confirmed' : undefined,
      confirmations: isConfirmed ? 1 : 0,
      time: transfer.createdTime ? Math.floor(transfer.createdTime.getTime() / 1000) : undefined,
      blocktime: transfer.updatedTime ? Math.floor(transfer.updatedTime.getTime() / 1000) : undefined,
      fee: 0,
    };
  }

  // --- FEE METHODS (always 0 for Spark L2) --- //

  async getNativeFee(): Promise<number> {
    return 0;
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.getTransaction(txHash).then((t) => t.fee);
  }

  // --- STATUS METHODS --- //

  async isHealthy(): Promise<boolean> {
    try {
      const wallet = await this.wallet;
      return wallet != null;
    } catch {
      return false;
    }
  }

  // --- BLOCKCHAIN CLIENT INTERFACE --- //

  async getNativeCoinBalance(): Promise<number> {
    const wallet = await this.wallet;

    const { balance } = await wallet.getBalance();

    return Number(balance) / 1e8;
  }

  async getNativeCoinBalanceForAddress(_address: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async isTxComplete(txId: string, _minConfirmations = 1): Promise<boolean> {
    try {
      const tx = await this.getTransaction(txId);
      return tx.confirmations > 0;
    } catch {
      return false;
    }
  }

  async getTokenBalance(): Promise<number> {
    throw new Error('Method not implemented');
  }

  async getTokenBalances(): Promise<BlockchainTokenBalance[]> {
    throw new Error('Method not implemented');
  }

  async getToken(): Promise<Currency> {
    throw new Error('Method not implemented');
  }

  async sendSignedTransaction(): Promise<any> {
    throw new Error('Method not implemented');
  }
}
