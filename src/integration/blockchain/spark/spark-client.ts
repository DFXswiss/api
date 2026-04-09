import { SparkWallet } from '@buildonspark/spark-sdk';
import { Currency } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncField } from 'src/shared/utils/async-field';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';

export interface SparkTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
}

export enum SparkTransferDirection {
  INCOMING = 'INCOMING',
  OUTGOING = 'OUTGOING',
}

export interface SparkTransfer {
  id: string;
  amountSats: number;
  status: string;
  direction: SparkTransferDirection;
  senderSparkAddress?: string;
  receiverSparkAddress?: string;
  createdTime?: Date;
  updatedTime?: Date;
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

export class SparkClient extends BlockchainClient {
  private static readonly INIT_TIMEOUT_MS = 60_000;

  private readonly logger = new DfxLogger(SparkClient);

  private wallet: AsyncField<SparkWallet>;
  private readonly cachedAddress: AsyncField<string>;
  private reconnectAttempt = 0;
  private tokenOptimizationInterval?: NodeJS.Timeout;

  constructor() {
    super();

    this.wallet = new AsyncField(() => this.initializeWallet(), true);
    this.cachedAddress = new AsyncField(() => this.wallet.then((w) => w.getSparkAddress()), true);
    this.startTokenOptimization();
  }

  private async call<T>(operation: (wallet: SparkWallet) => Promise<T>): Promise<T> {
    try {
      const wallet = await this.wallet;
      return await operation(wallet);
    } catch (e) {
      if (e?.message?.includes('Channel has been shut down')) {
        this.logger.info('Spark channel shut down, reinitializing wallet...');
        this.wallet.reset();
        this.cachedAddress.reset();
        const wallet = await this.wallet;
        return operation(wallet);
      }
      throw e;
    }
  }

  get walletAddress(): string {
    return this.cachedAddress.value;
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.call(async (wallet) => {
      const amountSats = Math.round(amount * 1e8);

      await this.syncLeaves(wallet);

      const result = await wallet.transfer({
        amountSats,
        receiverSparkAddress: to,
      });

      return { txid: result.id, fee: 0 };
    });
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    return this.call(async (wallet) => {
      await this.syncLeaves(wallet);

      const transfer = await wallet.getTransfer(txId);

      if (!transfer) {
        throw new Error(`Transaction ${txId} not found`);
      }

      // Outgoing: complete once sender key is tweaked (funds left our wallet)
      // Incoming: complete once receiver has claimed
      const isConfirmed = ['TRANSFER_STATUS_SENDER_KEY_TWEAKED', 'TRANSFER_STATUS_COMPLETED'].includes(transfer.status);

      return {
        txid: transfer.id,
        blockhash: isConfirmed ? 'confirmed' : undefined,
        confirmations: isConfirmed ? 1 : 0,
        time: transfer.createdTime ? Math.floor(transfer.createdTime.getTime() / 1000) : undefined,
        blocktime: transfer.updatedTime ? Math.floor(transfer.updatedTime.getTime() / 1000) : undefined,
        fee: 0,
      };
    });
  }

  async getTransfers(limit = 100, offset = 0): Promise<SparkTransfer[]> {
    const wallet = await this.wallet;
    const result = await wallet.getTransfers(limit, offset);

    return result.transfers.map((t) => ({
      id: t.id,
      amountSats: t.totalValue,
      status: t.status,
      direction: t.transferDirection as SparkTransferDirection,
      senderSparkAddress: t.senderIdentityPublicKey,
      receiverSparkAddress: t.receiverIdentityPublicKey,
      createdTime: t.createdTime,
      updatedTime: t.updatedTime,
    }));
  }

  async getIncomingTransfers(limit = 100, offset = 0): Promise<SparkTransfer[]> {
    const transfers = await this.getTransfers(limit, offset);

    // Filter only completed incoming transfers
    return transfers.filter(
      (t) => t.status === 'TRANSFER_STATUS_COMPLETED' && t.direction === SparkTransferDirection.INCOMING,
    );
  }

  // --- WALLET INITIALIZATION --- //

  private async initializeWallet(): Promise<SparkWallet> {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const wallet = await this.initializeWithTimeout();

        wallet.on('stream:disconnected', () => this.reconnectWallet());

        return await this.syncLeaves(wallet);
      } catch (e) {
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        this.logger.warn(
          `Spark wallet initialization failed (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s: ${e.message}`,
        );

        if (attempt === maxRetries) throw e;

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error('Spark wallet initialization failed after all retries');
  }

  private initializeWithTimeout(): Promise<SparkWallet> {
    return new Promise<SparkWallet>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Spark wallet initialization timed out after ${SparkClient.INIT_TIMEOUT_MS / 1000}s`)),
        SparkClient.INIT_TIMEOUT_MS,
      );

      SparkWallet.initialize({
        mnemonicOrSeed: GetConfig().blockchain.spark.sparkWalletSeed,
        accountNumber: 0,
        options: {
          network: 'MAINNET',
          tokenOptimizationOptions: { enabled: false },
        },
      })
        .then(({ wallet }) => {
          clearTimeout(timer);
          resolve(wallet);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  private startTokenOptimization(): void {
    if (this.tokenOptimizationInterval) clearInterval(this.tokenOptimizationInterval);

    const intervalMs = 5 * 60 * 1000; // 5 minutes
    this.tokenOptimizationInterval = setInterval(() => {
      this.call((wallet) => wallet.optimizeTokenOutputs()).catch((e) => {
        this.logger.warn('Token optimization failed, will retry on next interval:', e);
      });
    }, intervalMs);
  }

  private reconnectWallet(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 60_000);
    this.reconnectAttempt++;

    this.logger.warn(`Spark stream disconnected, reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})`);

    this.wallet = new AsyncField(
      () =>
        new Promise<void>((resolve) => setTimeout(resolve, delay))
          .then(() => this.initializeWallet())
          .then((wallet) => {
            this.reconnectAttempt = 0;
            this.logger.info('Spark wallet reconnected successfully');
            return wallet;
          })
          .catch((e: Error) => {
            this.logger.error('Spark wallet reconnect failed', e);
            this.reconnectWallet();
            throw e;
          }),
      true,
    );
  }

  // --- SYNC METHODS --- //

  private async syncLeaves(wallet: SparkWallet): Promise<SparkWallet> {
    // SDK bug: internal this.leaves cache is not synced on initialization or after deposits
    // optimizeLeaves() fetches fresh leaves from network and updates the cache at the start,
    // even when no optimization swaps are needed - consume generator to trigger sync
    for await (const _ of wallet.optimizeLeaves()) {
      /* Consume generator - sync happens at generator start */
    }

    return wallet;
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
      return await this.call(async (wallet) => wallet != null);
    } catch {
      return false;
    }
  }

  // --- BLOCKCHAIN CLIENT INTERFACE --- //

  async getNativeCoinBalance(): Promise<number> {
    return this.call(async (wallet) => {
      const { balance } = await wallet.getBalance();

      await this.syncLeaves(wallet);

      return Number(balance) / 1e8;
    });
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

  async sendSignedTransaction(_tx: string): Promise<SignedTransactionResponse> {
    throw new Error('Method not implemented');
  }
}
