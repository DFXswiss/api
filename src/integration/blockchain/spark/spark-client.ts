import { SparkWallet } from '@buildonspark/spark-sdk';
import { Currency } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
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
  private readonly wallet: AsyncField<SparkWallet>;
  private readonly cachedAddress: AsyncField<string>;

  constructor() {
    super();

    this.wallet = new AsyncField(() =>
      SparkWallet.initialize({
        mnemonicOrSeed: GetConfig().blockchain.spark.sparkWalletSeed,
        accountNumber: 0,
        options: { network: 'MAINNET' },
      }).then(({ wallet }) => this.syncLeaves(wallet)),
    );
    this.cachedAddress = new AsyncField(() => this.wallet.then((w) => w.getSparkAddress()), true);
  }

  get walletAddress(): string {
    return this.cachedAddress.value;
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    const wallet = await this.wallet;

    await this.syncLeaves(wallet);

    const amountSats = Math.round(amount * 1e8);

    const result = await wallet.transfer({
      amountSats,
      receiverSparkAddress: to,
    });

    return { txid: result.id, fee: 0 };
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
      const wallet = await this.wallet;
      return wallet != null;
    } catch {
      return false;
    }
  }

  // --- BLOCKCHAIN CLIENT INTERFACE --- //

  async getNativeCoinBalance(): Promise<number> {
    const wallet = await this.wallet;

    await this.syncLeaves(wallet);

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
