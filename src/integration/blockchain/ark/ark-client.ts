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
  private reconnectAttempt = 0;

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
      const vtxos = await wallet.getVtxos();
      const vtxo = vtxos.find((v) => v.txid === txId);

      const isConfirmed = vtxo != null;

      return {
        txid: txId,
        blockhash: isConfirmed ? 'confirmed' : undefined,
        confirmations: isConfirmed ? 1 : 0,
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

  private reconnectWallet(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 60_000);
    this.reconnectAttempt++;

    this.logger.warn(`Ark connection lost, reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})`);

    this.wallet = new AsyncField(
      () =>
        new Promise<void>((resolve) => setTimeout(resolve, delay))
          .then(() => this.initializeWallet())
          .then((wallet) => {
            this.reconnectAttempt = 0;
            this.logger.info('Ark wallet reconnected successfully');
            return wallet;
          })
          .catch((e: Error) => {
            this.logger.error('Ark wallet reconnect failed', e);
            this.reconnectWallet();
            throw e;
          }),
      true,
    );
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
