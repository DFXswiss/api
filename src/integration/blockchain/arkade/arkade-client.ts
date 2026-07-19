import { Wallet, SingleKey, InMemoryWalletRepository, InMemoryContractRepository } from '@arkade-os/sdk';
import { Currency } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncField } from 'src/shared/utils/async-field';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { TxBroadcastError } from '../shared/errors/tx-broadcast.error';
import { BlockchainClient } from '../shared/util/blockchain-client';

export interface ArkadeTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
}

export class ArkadeClient extends BlockchainClient {
  private readonly logger = new DfxLogger(ArkadeClient);

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
        this.logger.info('Arkade connection lost, reinitializing wallet...');
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
    // Pre-broadcast: resolving the wallet handle never calls sendBitcoin, so a failure here is
    // provably pre-broadcast. Reset the cache so the next retry gets a fresh connection attempt
    // instead of repeating a possibly permanently-rejected cached promise.
    let wallet: Wallet;
    try {
      wallet = await this.wallet;
    } catch (e) {
      this.wallet.reset();
      this.cachedAddress.reset();
      throw e;
    }

    const amountSats = Math.round(amount * 1e8);

    // Broadcast boundary: wallet.sendBitcoin signs AND broadcasts atomically inside the SDK - there
    // is no separate pre-broadcast step to isolate, so any failure from here on is ambiguous (the
    // tx may already be on-chain). Deliberately NOT routed through this.call()'s reconnect-and-retry:
    // that wrapper re-invokes the whole operation on a connection-classified error, which for a
    // broadcast would risk sending twice. Reset the cache on such an error so only the *next* call
    // reconnects, without resending this one.
    try {
      const txid = await wallet.sendBitcoin({
        address: to,
        amount: amountSats,
      });

      // An empty txid from the SDK is an ambiguous silent failure - fail-closed rather than
      // returning it and letting the empty id roll the order back for re-broadcast.
      if (!txid) throw new TxBroadcastError('Arkade broadcast returned an empty txid');

      return { txid, fee: 0 };
    } catch (e) {
      if (e instanceof TxBroadcastError) throw e;
      if (e?.message?.includes('disconnected') || e?.message?.includes('connection')) {
        this.wallet.reset();
        this.cachedAddress.reset();
      }
      throw new TxBroadcastError(e instanceof Error ? e.message : String(e), { cause: e });
    }
  }

  async getTransaction(txId: string): Promise<ArkadeTransaction> {
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
    const { arkadePrivateKey, arkadeServerUrl } = GetConfig().blockchain.arkade;

    const identity = SingleKey.fromHex(arkadePrivateKey);

    const wallet = await Wallet.create({
      identity,
      arkServerUrl: arkadeServerUrl,
      storage: {
        walletRepository: new InMemoryWalletRepository(),
        contractRepository: new InMemoryContractRepository(),
      },
    });

    // Stop the unused background ContractWatcher (broken on Node 20, floods logs).
    try {
      const contractManager = await wallet.getContractManager();
      contractManager.dispose();
    } catch (e) {
      this.logger.info(`Could not dispose Arkade contract watcher: ${e?.message ?? e}`);
    }

    return wallet;
  }

  // --- FEE METHODS (near-zero for Arkade L2) --- //

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

  async sendSignedTransaction(_tx: string): Promise<SignedTransactionResponse> {
    throw new Error('Method not implemented');
  }
}
