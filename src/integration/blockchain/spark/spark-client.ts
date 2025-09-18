import { Injectable } from '@nestjs/common';
import { Currency } from '@uniswap/sdk-core';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SparkWallet, isValidSparkAddress } from '@buildonspark/spark-sdk';

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
  feerate: number;
  blocks: number;
}

@Injectable()
export class SparkClient extends BlockchainClient {
  private readonly logger = new DfxLogger(SparkClient);
  private wallet: SparkWallet | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly http: HttpService) {
    super();
    // Initialize wallet lazily when first needed
    this.initPromise = null;
  }

  private async initializeWallet(): Promise<void> {
    try {
      // Initialize SparkWallet with config
      const network = Config.blockchain.spark.network === 'testnet' ? 'TESTNET' : 'MAINNET';

      const walletSeed = process.env.SPARK_WALLET_SEED;
      if (!walletSeed) {
        throw new Error('SPARK_WALLET_SEED environment variable is required');
      }

      const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: walletSeed,
        accountNumber: 0,
        options: {
          network: network as any, // SDK expects specific type
        },
      });

      this.wallet = wallet;
      // Cache the address immediately after initialization
      this.cachedAddress = await wallet.getSparkAddress();
      this.logger.info(`SparkWallet initialized successfully with address: ${this.cachedAddress}`);
    } catch (error) {
      this.logger.error('Failed to initialize SparkWallet:', error);
      throw new Error(`Failed to initialize SparkWallet: ${error.message}`);
    }
  }

  private cachedAddress: string | null = null;

  get walletAddress(): string {
    // Return cached address or placeholder
    // Note: getSparkAddress() is async, but getter must be sync
    if (!this.cachedAddress) {
      if (!this.wallet) {
        return 'spark-wallet-not-initialized';
      }
      // Cache the address asynchronously
      this.wallet.getSparkAddress().then(address => {
        this.cachedAddress = address;
      }).catch(error => {
        this.logger.warn('Failed to get Spark address from wallet:', error);
      });
      return 'spark-address-loading';
    }
    return this.cachedAddress;
  }

  private async ensureWallet(): Promise<SparkWallet> {
    if (!this.initPromise && !this.wallet) {
      this.initPromise = this.initializeWallet();
    }
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    if (!this.wallet) {
      throw new Error('SparkWallet not initialized');
    }
    return this.wallet;
  }


  // --- TRANSACTION METHODS --- //

  async sendMany(
    outputs: { addressTo: string; amount: number }[],
    feeRate: number,
  ): Promise<string> {
    try {
      const wallet = await this.ensureWallet();

      // For multiple outputs, send transactions sequentially
      // SDK doesn't support batch transfers in a single transaction
      const txids: string[] = [];

      for (const output of outputs) {
        const amountSats = Math.round(output.amount * 1e8);
        const result = await wallet.transfer({
          amountSats,
          receiverSparkAddress: output.addressTo,
        });
        txids.push(result.id);
      }

      const batchId = txids.join(',');
      this.logger.verbose(`Spark batch transactions sent via SDK (fee-free): ${batchId}`);
      return batchId;
    } catch (error) {
      this.logger.error('Failed to send Spark batch transaction:', error);
      throw error;
    }
  }

  async sendTransaction(
    to: string,
    amount: number,
    feeRate: number,
  ): Promise<{ txid: string; fee: number }> {
    try {
      const wallet = await this.ensureWallet();

      // Use real SDK transfer method
      const amountSats = Math.round(amount * 1e8); // Convert BTC to satoshis
      const result = await wallet.transfer({
        amountSats,
        receiverSparkAddress: to,
      });

      this.logger.verbose(`Spark transaction sent via SDK (fee-free): ${result.id}`);
      return { txid: result.id, fee: 0 };
    } catch (error) {
      this.logger.error('Failed to send Spark transaction:', error);
      throw error;
    }
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    try {
      const wallet = await this.ensureWallet();
      const transfer = await wallet.getTransfer(txId);

      if (!transfer) {
        throw new Error(`Transaction ${txId} not found`);
      }

      // Map WalletTransfer to SparkTransaction format
      // SPARK uses final confirmation - either confirmed (1) or not (0)
      const isConfirmed = transfer.status === 'TRANSFER_STATUS_COMPLETED';

      return {
        txid: transfer.id,
        blockhash: isConfirmed ? 'confirmed' : undefined,
        confirmations: isConfirmed ? 1 : 0, // Binary: 1 = final, 0 = pending
        time: transfer.createdTime ? Math.floor(transfer.createdTime.getTime() / 1000) : undefined,
        blocktime: transfer.updatedTime ? Math.floor(transfer.updatedTime.getTime() / 1000) : undefined,
        fee: 0, // SPARK has no fees
      };
    } catch (error) {
      this.logger.error(`Failed to get transaction ${txId}:`, error);
      throw error;
    }
  }



  // --- BALANCE METHODS --- //

  async getBalance(address?: string): Promise<number> {
    const wallet = await this.ensureWallet();

    // Use real SDK getBalance method
    const { balance, tokenBalances } = await wallet.getBalance();
    // Convert satoshis to BTC
    const btcBalance = Number(balance) / 1e8;
    this.logger.verbose(`Spark balance from SDK: ${btcBalance} BTC`);
    return btcBalance;
  }

  async getWalletBalance(): Promise<number> {
    return this.getBalance();
  }

  // --- FEE METHODS --- //

  async estimateFee(blocks = 6): Promise<SparkFeeEstimate> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return { feerate: 0, blocks };
  }

  async getNetworkFeeRate(): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return 0;
  }

  // --- BLOCKCHAIN INFO --- //

  async getInfo(): Promise<SparkNodeInfo> {
    // Return basic info - SDK doesn't provide detailed network info
    const wallet = await this.ensureWallet();
    return {
      version: '1.0.0',
      testnet: Config.blockchain.spark.network === 'testnet',
      connections: wallet ? 1 : 0, // Assume connected if wallet exists
    };
  }


  // --- ADDRESS METHODS --- //

  async validateAddress(address: string): Promise<{ isvalid: boolean; address?: string }> {
    // Use SDK validation
    try {
      const isValid = isValidSparkAddress(address);
      return { isvalid: isValid, address: isValid ? address : undefined };
    } catch {
      return { isvalid: false };
    }
  }




  // --- STATUS METHODS --- //

  async isHealthy(): Promise<boolean> {
    try {
      const wallet = await this.ensureWallet();
      // If wallet exists and is initialized, consider it healthy
      return wallet !== null && wallet !== undefined;
    } catch {
      return false;
    }
  }

  async isSynced(): Promise<boolean> {
    try {
      const wallet = await this.ensureWallet();
      // If wallet exists, assume it's synced (SDK handles sync internally)
      return wallet !== null && wallet !== undefined;
    } catch {
      return false;
    }
  }

  // --- BLOCKCHAIN CLIENT INTERFACE METHODS --- //

  async sendSignedTransaction(hex: string): Promise<any> {
    // SPARK uses SDK methods, not raw hex transactions
    throw new Error('SPARK does not support raw hex transactions - use SDK transfer methods');
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getWalletBalance();
  }

  async getNativeCoinBalanceForAddress(_address: string): Promise<number> {
    // Spark SDK doesn't support querying other addresses
    return this.getBalance();
  }

  async getTokenBalance(_asset: Asset, _address?: string): Promise<number> {
    throw new Error('Spark has no tokens');
  }

  async getTokenBalances(_assets: Asset[], _address?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Spark has no tokens');
  }

  async getToken(_asset: Asset): Promise<Currency> {
    throw new Error('Spark has no tokens');
  }

  async getTx(txId: string): Promise<any> {
    return this.getTransaction(txId);
  }

  async isTxComplete(txId: string, minConfirmations = 1): Promise<boolean> {
    try {
      const tx = await this.getTransaction(txId);
      // SPARK has binary confirmation: either final (1) or pending (0)
      // Any minConfirmations > 0 requires the tx to be confirmed
      return minConfirmations > 0 ? tx.confirmations === 1 : true;
    } catch {
      return false;
    }
  }
}