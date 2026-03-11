import { Wallet, SingleKey } from '@arkade-os/sdk';
import { Currency } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncField } from 'src/shared/utils/async-field';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';

export interface ArkTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
}

export class ArkClient extends BlockchainClient {
  private readonly logger = new DfxLogger(ArkClient);

  private wallet: AsyncField<Wallet>;
  private readonly cachedAddress: AsyncField<string>;

  constructor() {
    super();

    this.wallet = new AsyncField(() => this.initializeWallet(), true);
    this.cachedAddress = new AsyncField(() => this.wallet.then((w) => w.getAddress()), true);
  }

  private async call<T>(operation: (wallet: Wallet) => Promise<T>): Promise<T> {
    try {
      const wallet = await this.wallet;
      return await operation(wallet);
    } catch (e) {
      if (e?.message?.includes('disconnected') || e?.message?.includes('connection')) {
        this.logger.info('Ark connection lost, reinitializing wallet...');
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

      const txid = await wallet.sendBitcoin({
        address: to,
        amount: amountSats,
      });

      return { txid, fee: 0 };
    });
  }

  async getTransaction(txId: string): Promise<ArkTransaction> {
    return this.call(async (wallet) => {
      // Finalize any pending transactions, then check if the tx is settled
      const { finalized } = await wallet.finalizePendingTxs();
      const isConfirmed = finalized.some((id) => id === txId);

      // Also check VTXOs for incoming transactions
      if (!isConfirmed) {
        const vtxos = await wallet.getVtxos();
        const hasVtxo = vtxos.some((v) => v.txid === txId);

        return {
          txid: txId,
          blockhash: hasVtxo ? 'confirmed' : undefined,
          confirmations: hasVtxo ? 1 : 0,
          fee: 0,
        };
      }

      return {
        txid: txId,
        blockhash: 'confirmed',
        confirmations: 1,
        fee: 0,
      };
    });
  }

  // --- WALLET INITIALIZATION --- //

  private async initializeWallet(): Promise<Wallet> {
    const { arkPrivateKey, arkServerUrl } = GetConfig().blockchain.ark;

    const identity = SingleKey.fromHex(arkPrivateKey);

    const wallet = await Wallet.create({
      identity,
      arkServerUrl,
    });

    return wallet;
  }

  // --- FEE METHODS (near-zero for Ark L2) --- //

  async getNativeFee(): Promise<number> {
    return 0;
  }

  async getTxActualFee(_txHash: string): Promise<number> {
    return 0;
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
      const balance = await wallet.getBalance();

      return Number(balance.available) / 1e8;
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

  async sendSignedTransaction(): Promise<any> {
    throw new Error('Method not implemented');
  }
}
