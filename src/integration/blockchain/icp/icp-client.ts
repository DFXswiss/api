import { Actor, HttpAgent } from '@dfinity/agent';
import { IcpLedgerCanister } from '@dfinity/ledger-icp';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { Principal } from '@dfinity/principal';
import { Config, GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import {
  CandidBlock,
  CandidIcrcTransaction,
  IcpNativeRawLedger,
  IcpTransfer,
  IcpTransferQueryResult,
  IcrcRawLedger,
} from './dto/icp.dto';
import { InternetComputerWallet } from './icp-wallet';
import { icpNativeLedgerIdlFactory, icrcLedgerIdlFactory } from './icp.idl';
import { InternetComputerUtil } from './icp.util';

export class InternetComputerClient extends BlockchainClient {
  private readonly logger = new DfxLogger(InternetComputerClient);

  private readonly host: string;
  private readonly seed: string;
  private readonly wallet: InternetComputerWallet;
  private readonly agent: HttpAgent;
  private readonly nativeLedger: IcrcLedgerCanister;
  private readonly transferFee: number;

  private readonly nativeRawLedger: IcpNativeRawLedger;
  private readonly icrcRawLedgers: Map<string, IcrcRawLedger> = new Map();

  constructor() {
    super();

    const { internetComputerHost, internetComputerWalletSeed, internetComputerLedgerCanisterId, transferFee } =
      GetConfig().blockchain.internetComputer;
    this.host = internetComputerHost;
    this.seed = internetComputerWalletSeed;
    this.transferFee = transferFee;

    this.wallet = InternetComputerWallet.fromSeed(internetComputerWalletSeed, 0);
    this.agent = this.wallet.getAgent(this.host);

    this.nativeLedger = IcrcLedgerCanister.create({
      agent: this.agent,
      canisterId: Principal.fromText(internetComputerLedgerCanisterId),
    });

    this.nativeRawLedger = Actor.createActor<IcpNativeRawLedger>(icpNativeLedgerIdlFactory, {
      agent: this.agent,
      canisterId: Principal.fromText(internetComputerLedgerCanisterId),
    });
  }

  private static createIcrcRawLedger(agent: HttpAgent, canisterId: string): IcrcRawLedger {
    return Actor.createActor<IcrcRawLedger>(icrcLedgerIdlFactory, {
      agent,
      canisterId: Principal.fromText(canisterId),
    });
  }

  private getOrCreateIcrcRawLedger(canisterId: string): IcrcRawLedger {
    let ledger = this.icrcRawLedgers.get(canisterId);

    if (!ledger) {
      ledger = InternetComputerClient.createIcrcRawLedger(this.agent, canisterId);
      this.icrcRawLedgers.set(canisterId, ledger);
    }

    return ledger;
  }

  get walletAddress(): string {
    return this.wallet.address;
  }

  get principal(): Principal {
    return this.wallet.principal;
  }

  // --- Balance ---

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.nativeLedger.balance({
      owner: Principal.fromText(address),
      certified: false,
    });

    return InternetComputerUtil.fromSmallestUnit(balance);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset], address);
    return tokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const ownerPrincipal = address ?? this.principal.toText();

    return Promise.all(
      assets.map(async (asset) => {
        const canisterId = asset.chainId;
        if (!canisterId) return { owner: ownerPrincipal, contractAddress: '', balance: 0 };

        try {
          const tokenLedger = IcrcLedgerCanister.create({
            agent: this.agent,
            canisterId: Principal.fromText(canisterId),
          });

          const balance = await tokenLedger.balance({
            owner: Principal.fromText(ownerPrincipal),
            certified: false,
          });

          return {
            owner: ownerPrincipal,
            contractAddress: canisterId,
            balance: InternetComputerUtil.fromSmallestUnit(balance, asset.decimals),
          };
        } catch (e) {
          this.logger.error(`Failed to get token balance for ${canisterId}:`, e);
          return { owner: ownerPrincipal, contractAddress: canisterId, balance: 0 };
        }
      }),
    );
  }

  // --- Block height & transfers (ICP native: query_blocks) ---

  async getBlockHeight(): Promise<number> {
    const response = await this.nativeRawLedger.query_blocks({
      start: 0n,
      length: 0n,
    });
    return Number(response.chain_length);
  }

  async getTransfers(start: number, count: number): Promise<IcpTransferQueryResult> {
    const response = await this.nativeRawLedger.query_blocks({
      start: BigInt(start),
      length: BigInt(count),
    });

    const firstIndex = Number(response.first_block_index);
    const transfers: IcpTransfer[] = [];

    for (let i = 0; i < response.blocks.length; i++) {
      const transfer = this.mapBlockToTransfer(response.blocks[i], firstIndex + i);
      if (transfer) transfers.push(transfer);
    }

    // If blocks are empty but first_block_index > start, blocks in that range are archived — skip ahead
    const chainLength = Number(response.chain_length);

    let lastIndex: number;

    if (response.blocks.length > 0) {
      lastIndex = firstIndex + response.blocks.length - 1;
    } else if (firstIndex > start) {
      lastIndex = firstIndex - 1;
      this.logger.info(`Skipping archived blocks ${start}-${lastIndex}, next query starts at ${firstIndex}`);
    } else {
      lastIndex = start - 1;
    }

    return { transfers, lastBlockIndex: lastIndex, chainLength };
  }

  private mapBlockToTransfer(block: CandidBlock, index: number): IcpTransfer | undefined {
    const operation = block.transaction.operation[0];
    if (!operation || !('Transfer' in operation)) return undefined;

    const transfer = operation.Transfer;

    return {
      blockIndex: index,
      from: Util.uint8ToString(transfer.from, 'hex'),
      to: Util.uint8ToString(transfer.to, 'hex'),
      amount: InternetComputerUtil.fromSmallestUnit(transfer.amount.e8s),
      fee: InternetComputerUtil.fromSmallestUnit(transfer.fee.e8s),
      memo: block.transaction.memo,
      timestamp: Number(block.timestamp.timestamp_nanos / 1000000000n),
    };
  }

  // --- Block height & transfers (ICRC-3, for ck-tokens) ---

  async getIcrcBlockHeight(canisterId: string): Promise<number> {
    const ledger = this.getOrCreateIcrcRawLedger(canisterId);
    const response = await ledger.get_transactions({
      start: 0n,
      length: 0n,
    });
    return Number(response.log_length);
  }

  async getIcrcTransfers(
    canisterId: string,
    decimals: number,
    start: number,
    count: number,
  ): Promise<IcpTransferQueryResult> {
    const ledger = this.getOrCreateIcrcRawLedger(canisterId);
    const response = await ledger.get_transactions({
      start: BigInt(start),
      length: BigInt(count),
    });

    const firstIndex = Number(response.first_index);
    const transfers: IcpTransfer[] = [];

    for (let i = 0; i < response.transactions.length; i++) {
      const transfer = this.mapIcrcTransaction(response.transactions[i], firstIndex + i, decimals);
      if (transfer) transfers.push(transfer);
    }

    const lastIndex = response.transactions.length > 0 ? firstIndex + response.transactions.length - 1 : start - 1;

    return { transfers, lastBlockIndex: lastIndex, chainLength: Number(response.log_length) };
  }

  private mapIcrcTransaction(tx: CandidIcrcTransaction, index: number, decimals: number): IcpTransfer | undefined {
    if (tx.kind !== 'transfer' || !tx.transfer[0]) return undefined;
    const transfer = tx.transfer[0];

    return {
      blockIndex: index,
      from: transfer.from.owner.toText(),
      to: transfer.to.owner.toText(),
      amount: InternetComputerUtil.fromSmallestUnit(transfer.amount, decimals),
      fee: transfer.fee[0] ? InternetComputerUtil.fromSmallestUnit(transfer.fee[0], decimals) : 0,
      memo: 0n,
      timestamp: Number(tx.timestamp / 1000000000n),
    };
  }

  async isTxComplete(txId: string): Promise<boolean> {
    try {
      // Token txIds have format "canisterId:blockIndex"
      const parts = txId.split(':');
      if (parts.length === 2) {
        const [canisterId, indexStr] = parts;
        const index = Number(indexStr);
        const chainLength = await this.getIcrcBlockHeight(canisterId);
        return index < chainLength;
      }

      // Native ICP txIds are plain block indices
      const index = Number(txId);
      const chainLength = await this.getBlockHeight();
      return index < chainLength;
    } catch (e) {
      this.logger.error(`Failed to check tx completion for ${txId}:`, e);
      return false;
    }
  }

  // --- Send native coin ---

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount);
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = InternetComputerWallet.fromSeed(account.seed, account.index);
    const balance = await this.getNativeCoinBalanceForAddress(wallet.address);

    const sendAmount = Math.min(amount, balance) - this.transferFee;
    if (sendAmount <= 0)
      throw new Error(`Insufficient balance for payment forward: balance=${balance}, fee=${this.transferFee}`);

    return this.sendNativeCoin(wallet, toAddress, sendAmount);
  }

  async sendNativeCoinFromDepositWallet(accountIndex: number, toAddress: string, amount: number): Promise<string> {
    const wallet = InternetComputerWallet.fromSeed(this.seed, accountIndex);
    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  private async sendNativeCoin(wallet: InternetComputerWallet, toAddress: string, amount: number): Promise<string> {
    const agent = wallet.getAgent(this.host);
    const ledger = IcpLedgerCanister.create({ agent });

    const blockIndex = await ledger.icrc1Transfer({
      to: {
        owner: Principal.fromText(toAddress),
        subaccount: [],
      },
      amount: InternetComputerUtil.toSmallestUnit(amount),
    });

    return blockIndex.toString();
  }

  // --- Send token ---

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.sendToken(this.wallet, toAddress, token, amount);
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number): Promise<string> {
    const wallet = InternetComputerWallet.fromSeed(account.seed, account.index);
    const balance = await this.getTokenBalance(token, wallet.address);
    const fee = await this.getCurrentGasCostForTokenTransaction(token);

    const sendAmount = Math.min(amount, balance) - fee;
    if (sendAmount <= 0)
      throw new Error(`Insufficient token balance for payment forward: balance=${balance}, fee=${fee}`);

    return this.sendToken(wallet, toAddress, token, sendAmount);
  }

  async sendTokenFromDepositWallet(
    accountIndex: number,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    const wallet = InternetComputerWallet.fromSeed(this.seed, accountIndex);
    return this.sendToken(wallet, toAddress, token, amount);
  }

  private async sendToken(
    wallet: InternetComputerWallet,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    const canisterId = token.chainId;
    if (!canisterId) throw new Error(`No canister ID for token ${token.uniqueName}`);

    const agent = wallet.getAgent(this.host);
    const tokenLedger = IcrcLedgerCanister.create({
      agent,
      canisterId: Principal.fromText(canisterId),
    });

    const blockIndex = await tokenLedger.transfer({
      to: {
        owner: Principal.fromText(toAddress),
        subaccount: [],
      },
      amount: InternetComputerUtil.toSmallestUnit(amount, token.decimals),
    });

    return `${canisterId}:${blockIndex}`;
  }

  // --- ICRC-2 Approve/TransferFrom ---

  async checkAllowance(
    ownerPrincipal: string,
    spenderPrincipal: string,
    canisterId: string,
    decimals: number,
  ): Promise<{ allowance: number; expiresAt?: number }> {
    const tokenLedger = IcrcLedgerCanister.create({
      agent: this.agent,
      canisterId: Principal.fromText(canisterId),
    });

    const result = await tokenLedger.allowance({
      account: { owner: Principal.fromText(ownerPrincipal), subaccount: [] },
      spender: { owner: Principal.fromText(spenderPrincipal), subaccount: [] },
      certified: false,
    });

    return {
      allowance: InternetComputerUtil.fromSmallestUnit(result.allowance, decimals),
      expiresAt: result.expires_at?.[0] ? Number(result.expires_at[0]) : undefined,
    };
  }

  async transferFromWithAccount(
    account: WalletAccount,
    ownerPrincipal: string,
    toAddress: string,
    amount: number,
    canisterId: string,
    decimals: number,
  ): Promise<string> {
    const wallet = InternetComputerWallet.fromSeed(account.seed, account.index);
    const agent = wallet.getAgent(this.host);

    const tokenLedger = IcrcLedgerCanister.create({
      agent,
      canisterId: Principal.fromText(canisterId),
    });

    const blockIndex = await tokenLedger.transferFrom({
      from: { owner: Principal.fromText(ownerPrincipal), subaccount: [] },
      to: { owner: Principal.fromText(toAddress), subaccount: [] },
      amount: InternetComputerUtil.toSmallestUnit(amount, decimals),
    });

    const isNative = canisterId === Config.blockchain.internetComputer.internetComputerLedgerCanisterId;
    return isNative ? blockIndex.toString() : `${canisterId}:${blockIndex}`;
  }

  // --- Misc ---

  async sendSignedTransaction(_tx: string): Promise<BlockchainSignedTransactionResponse> {
    return { error: { message: 'ICP does not support pre-signed transactions' } };
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.transferFee;
  }

  async getCurrentGasCostForTokenTransaction(token?: Asset): Promise<number> {
    if (!token?.chainId) return this.transferFee;

    try {
      const tokenLedger = IcrcLedgerCanister.create({
        agent: this.agent,
        canisterId: Principal.fromText(token.chainId),
      });

      const fee = await tokenLedger.transactionFee({ certified: false });
      return InternetComputerUtil.fromSmallestUnit(fee, token.decimals);
    } catch {
      return this.transferFee;
    }
  }

  async getTxActualFee(_blockIndex: string): Promise<number> {
    return this.transferFee;
  }
}
