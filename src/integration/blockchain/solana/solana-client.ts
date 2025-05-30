import * as SolanaToken from '@solana/spl-token';
import * as Solana from '@solana/web3.js';
import { Config, GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SolanaSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import {
  SolanaToken as SolanaBlockchainToken,
  SolanaNativeInstructionsDto,
  SolanaTokenDto,
  SolanaTokenInstructionsDto,
  SolanaTransactionDestinationDto,
  SolanaTransactionDto,
} from './dto/solana.dto';
import { SolanaWallet } from './solana-wallet';
import { SolanaUtil } from './SolanaUtil';

const INSTRUCTION_TYPES = ['create', 'closeAccount', 'transfer', 'transferchecked'];
const TOKEN_PROGRAM_IDS = [
  SolanaToken.TOKEN_PROGRAM_ID.toBase58(),
  SolanaToken.TOKEN_2022_PROGRAM_ID.toBase58(),
  SolanaToken.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
];

export class SolanaClient extends BlockchainClient {
  private readonly randomReceiverAddress = '3f5tFNkZDjGCjrkNRfLNE5Cr648H1yyCDdfYGHVcRqRV';

  private readonly url: string;

  private readonly wallet: SolanaWallet;
  private readonly connection: Solana.Connection;

  private readonly tokens = new AsyncCache<SolanaBlockchainToken>();

  constructor(private readonly http: HttpService) {
    super();

    const { solanaGatewayUrl, solanaApiKey, solanaWalletSeed } = GetConfig().blockchain.solana;
    this.url = `${solanaGatewayUrl}/${solanaApiKey ?? ''}`;

    this.connection = new Solana.Connection(this.url);
    this.wallet = SolanaWallet.create(solanaWalletSeed);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  async getBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight();
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.getWalletAddress());
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.connection.getBalance(new Solana.PublicKey(address), 'confirmed');
    return SolanaUtil.fromLamportAmount(balance);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset], address);

    return tokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const tokenBalances: BlockchainTokenBalance[] = [];

    const owner = address ?? this.getWalletAddress();

    for (const asset of assets) {
      const mint = new Solana.PublicKey(asset.chainId);

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        new Solana.PublicKey(owner),
        { mint },
        'confirmed',
      );

      let balance = 0;

      for (const tokenAccount of tokenAccounts.value) {
        const info = tokenAccount.account.data.parsed.info;
        const tokenAmount = info.tokenAmount;

        balance += SolanaUtil.fromLamportAmount(tokenAmount.amount, tokenAmount.decimals);
      }

      tokenBalances.push({ owner, contractAddress: mint.toBase58(), balance });
    }

    return tokenBalances;
  }

  async isTxComplete(txHash: string, confirmations = 0): Promise<boolean> {
    const transaction = await this.connection.getTransaction(txHash, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    const currentConfirmations = (await this.connection.getSlot()) - (transaction?.slot ?? Number.MAX_VALUE);

    if (currentConfirmations > confirmations) {
      if (!transaction.meta.err) return true;

      throw new Error(`Transaction ${txHash} has failed`);
    }

    return false;
  }

  async getToken(asset: Asset): Promise<SolanaBlockchainToken> {
    return this.getTokenByAddress(asset.chainId);
  }

  private async getTokenByAddress(address: string): Promise<SolanaBlockchainToken> {
    return this.tokens.get(address, async () => {
      const mintAccount = await SolanaToken.getMint(this.connection, new Solana.PublicKey(address));
      const mintAddress = mintAccount.address.toBase58();
      const decimals = mintAccount.decimals;
      return new SolanaBlockchainToken(mintAddress, decimals);
    });
  }

  private async sendTransaction(wallet: SolanaWallet, transaction: Solana.Transaction): Promise<string> {
    wallet.signTransaction(transaction);

    const hexTransaction = transaction.serialize().toString('hex');

    const result = await this.sendSignedTransaction(hexTransaction);
    if (result.error) throw new Error(result.error.message);

    return result.hash;
  }

  async sendSignedTransaction(hex: string): Promise<SolanaSignedTransactionResponse> {
    const hexToUse = hex.toLowerCase().startsWith('0x') ? hex.substring(0, 2) : hex;
    const tx = Buffer.from(hexToUse, 'hex').toString('base64');

    return this.http
      .post<{ result: string }>(this.url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          tx,
          {
            encoding: 'base64',
            skipPreflight: true,
            preflightCommitment: 'processed',
          },
        ],
      })
      .then((r) => ({ hash: r.result }))
      .catch((e) => ({
        error: {
          code: e.code,
          message: e.message,
        },
      }));
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = SolanaUtil.createWallet(account);
    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount);
  }

  private async sendNativeCoin(wallet: SolanaWallet, toAddress: string, amount: number): Promise<string> {
    const transaction = await this.createNativeCoinTransaction(wallet, toAddress, amount);
    return this.sendTransaction(wallet, transaction);
  }

  private async createNativeCoinTransaction(
    wallet: SolanaWallet,
    toAddress: string,
    amount: number,
  ): Promise<Solana.Transaction> {
    const transaction = new Solana.Transaction()
      .add(
        Solana.SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new Solana.PublicKey(toAddress),
          lamports: Solana.LAMPORTS_PER_SOL * amount,
        }),
      )
      .add(this.calculatePriorityFee());

    const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockHash.blockhash;

    return transaction;
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number): Promise<string> {
    const wallet = SolanaUtil.createWallet(account);
    return this.sendToken(wallet, toAddress, token, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.sendToken(this.wallet, toAddress, token, amount);
  }

  private async sendToken(wallet: SolanaWallet, toAddress: string, token: Asset, amount: number): Promise<string> {
    const transaction = await this.createTokenTransaction(wallet, token, toAddress, amount);
    return this.sendTransaction(wallet, transaction);
  }

  private async createTokenTransaction(
    wallet: SolanaWallet,
    token: Asset,
    toAddress: string,
    amount: number,
  ): Promise<Solana.Transaction> {
    const mintAddress = token.chainId;
    if (!mintAddress) throw new Error(`No mint address for token ${token.uniqueName} found`);
    const decimals = token.decimals;
    if (!decimals) throw new Error(`No decimals for token ${token.uniqueName} found`);

    const fromPublicKey = wallet.keypair.publicKey;
    const toPublicKey = new Solana.PublicKey(toAddress);

    const mintPublicKey = new Solana.PublicKey(mintAddress);

    const fromTokenAccount = await SolanaToken.getAssociatedTokenAddress(mintPublicKey, fromPublicKey);
    const toTokenAccount = await SolanaToken.getAssociatedTokenAddress(mintPublicKey, toPublicKey);

    const isTokenAccountAvailable = await this.checkTokenAccount(toAddress, mintAddress);

    const transaction = new Solana.Transaction();

    if (!isTokenAccountAvailable) {
      transaction.add(
        SolanaToken.createAssociatedTokenAccountInstruction(fromPublicKey, toTokenAccount, toPublicKey, mintPublicKey),
      );
    }

    transaction.add(
      SolanaToken.createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromPublicKey,
        SolanaUtil.toLamportAmount(amount, decimals),
        [],
        SolanaToken.TOKEN_PROGRAM_ID,
      ),
    );

    transaction.add(this.calculatePriorityFee());

    const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockHash.blockhash;

    return transaction;
  }

  async checkTokenAccount(address: string, mintAddress: string): Promise<boolean> {
    const accountsResponse = await this.connection.getTokenAccountsByOwner(new Solana.PublicKey(address), {
      mint: new Solana.PublicKey(mintAddress),
    });

    return accountsResponse.value.length > 0;
  }

  async closeTokenAccount(account: WalletAccount, mintAddress: string): Promise<string> {
    const wallet = SolanaUtil.createWallet(account);
    if (!(await this.checkTokenAccount(wallet.address, mintAddress))) return '';

    const feePayerPublicKey = wallet.keypair.publicKey;
    const mintPublicKey = new Solana.PublicKey(mintAddress);

    const tokenAccount = await SolanaToken.getAssociatedTokenAddress(mintPublicKey, feePayerPublicKey);

    const transaction = new Solana.Transaction();

    transaction.add(SolanaToken.createCloseAccountInstruction(tokenAccount, feePayerPublicKey, feePayerPublicKey));
    transaction.add(this.calculatePriorityFee());

    const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockHash.blockhash;

    return this.sendTransaction(wallet, transaction);
  }

  private calculatePriorityFee(): Solana.TransactionInstruction {
    const priorityRate = Config.blockchain.solana.transactionPriorityRate * 100;

    return Solana.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityRate });
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const amount = 10 / Solana.LAMPORTS_PER_SOL;
    const transaction = await this.createNativeCoinTransaction(this.wallet, this.randomReceiverAddress, amount);
    this.wallet.signTransaction(transaction);

    const response = await this.connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    const feeInLamports = response.value + Config.blockchain.solana.transactionPriorityRate;

    return SolanaUtil.fromLamportAmount(Math.floor(feeInLamports * 1.2));
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const amount = 10 / Solana.LAMPORTS_PER_SOL;
    const transaction = await this.createTokenTransaction(this.wallet, token, this.randomReceiverAddress, amount);
    this.wallet.signTransaction(transaction);

    const response = await this.connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    const feeInLamports = response.value + Config.blockchain.solana.transactionPriorityRate;

    return SolanaUtil.fromLamportAmount(Math.floor(feeInLamports * 1.2));
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.getTransaction(txHash).then((t) => t.fee ?? 0);
  }

  async getAllTokens(address: string): Promise<SolanaTokenDto[]> {
    return this.connection
      .getParsedTokenAccountsByOwner(
        new Solana.PublicKey(address),
        { programId: SolanaToken.TOKEN_PROGRAM_ID },
        'finalized',
      )
      .then((r) => r.value.map((v) => this.mapAccountInfo(v)));
  }

  private mapAccountInfo(accountInfo: {
    pubkey: Solana.PublicKey;
    account: Solana.AccountInfo<Solana.ParsedAccountData>;
  }): SolanaTokenDto {
    const info = accountInfo.account.data.parsed.info;
    const tokenAmount = info.tokenAmount;

    return {
      address: accountInfo.pubkey.toBase58(),
      mint: info.mint,
      owner: info.owner,
      amount: SolanaUtil.fromLamportAmount(tokenAmount.amount, tokenAmount.decimals),
      decimals: tokenAmount.decimals,
    };
  }

  async getTransaction(txHash: string): Promise<SolanaTransactionDto> {
    const parsedTransaction = await this.connection.getParsedTransaction(txHash, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    return this.createTransactionDto(parsedTransaction);
  }

  async getHistory(limit: number): Promise<SolanaTransactionDto[]> {
    const history: SolanaTransactionDto[] = [];

    const allSignatures = await this.connection
      .getSignaturesForAddress(this.wallet.publicKey, { limit }, 'finalized')
      .then((s) => s.map((s) => s.signature));

    const allParsedTransactions = await this.connection.getParsedTransactions(allSignatures, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    allParsedTransactions.sort((t1, t2) => t1.blockTime - t2.blockTime);

    for (const parsedTransaction of allParsedTransactions) {
      history.push(await this.createTransactionDto(parsedTransaction));
    }

    return history;
  }

  private async createTransactionDto(
    parsedTransaction: Solana.ParsedTransactionWithMeta,
  ): Promise<SolanaTransactionDto> {
    const accountKeys = parsedTransaction.transaction.message.accountKeys;
    const messageAccounts = accountKeys.filter((ak) => ak.signer && ak.source === 'transaction');
    const signers = messageAccounts.map((ma) => ma.pubkey.toBase58());

    const transaction: SolanaTransactionDto = {
      slotNumber: parsedTransaction.slot,
      blocktime: parsedTransaction.blockTime,
      txid: parsedTransaction.transaction.signatures[0],
      from: signers,
      fee: SolanaUtil.fromLamportAmount(parsedTransaction.meta.fee),
      destinations: [],
    };

    const allParsedInstructions = parsedTransaction.transaction.message.instructions as Solana.ParsedInstruction[];
    const parsedInstructions = allParsedInstructions.filter((i) =>
      INSTRUCTION_TYPES.includes(i.parsed?.type.toLowerCase()),
    );

    const isNativeTransaction = parsedInstructions.some(
      (i) => i.programId.toBase58() === Solana.SystemProgram.programId.toBase58(),
    );

    const isTokenTransaction = parsedInstructions.some((i) => TOKEN_PROGRAM_IDS.includes(i.programId.toBase58()));

    if (isNativeTransaction) {
      transaction.destinations.push(...this.getNativeTransactionDestinations(parsedInstructions));
    } else if (isTokenTransaction) {
      const tokenInstruction = this.getTokenInstructions(parsedTransaction);
      transaction.destinations.push(await this.getTokenTransactionDestination(tokenInstruction));
    }

    return transaction;
  }

  private getNativeTransactionDestinations(
    transferInstructions: Solana.ParsedInstruction[],
  ): SolanaTransactionDestinationDto[] {
    const transactionDestinations: SolanaTransactionDestinationDto[] = [];

    const instructionInfos: SolanaNativeInstructionsDto[] = transferInstructions
      .filter((ti) => ti.parsed.info)
      .map((ti) => {
        const info = ti.parsed.info;

        return {
          destination: info.destination,
          lamports: info.lamports,
          source: info.source,
        };
      });

    for (const instructionInfo of instructionInfos) {
      transactionDestinations.push({
        to: instructionInfo.destination,
        amount: SolanaUtil.fromLamportAmount(instructionInfo.lamports),
      });
    }

    return transactionDestinations;
  }

  private async getTokenTransactionDestination(
    tokenInstruction: Partial<SolanaTokenInstructionsDto>,
  ): Promise<SolanaTransactionDestinationDto> {
    const token = await this.getTokenByAddress(tokenInstruction.mint);

    return {
      to: tokenInstruction.destination,
      amount: SolanaUtil.fromLamportAmount(tokenInstruction.amount ?? 0, token.decimals),
      tokenInfo: {
        address: tokenInstruction.mint,
        decimals: token.decimals,
      },
    };
  }

  private getTokenInstructions(
    parsedTransaction: Solana.ParsedTransactionWithMeta,
  ): Partial<SolanaTokenInstructionsDto> {
    const parsedInstructions = parsedTransaction.transaction.message.instructions as Solana.ParsedInstruction[];

    const tokenInstruction: Partial<SolanaTokenInstructionsDto> = {};

    for (const instruction of parsedInstructions) {
      const info = instruction.parsed?.info;
      if (!info) continue;

      switch (instruction.parsed.type) {
        case 'create':
          tokenInstruction.mint = info.mint;
          tokenInstruction.source = info.source;
          tokenInstruction.destination = info.wallet;
          break;

        case 'closeAccount':
          tokenInstruction.destination = info.destination;
          tokenInstruction.source = info.owner;
          break;

        case 'transfer':
          tokenInstruction.authority = info.authority;
          tokenInstruction.amount = info.amount;
          break;

        case 'transferChecked':
          tokenInstruction.authority = info.authority ?? info.multisigAuthority;
          tokenInstruction.amount = info.tokenAmount.amount;
          break;
      }
    }

    if (!tokenInstruction.source && !tokenInstruction.destination && !tokenInstruction.mint) {
      this.updateTokenInstruction(parsedTransaction, tokenInstruction);
    }

    return tokenInstruction;
  }

  private updateTokenInstruction(
    parsedTransaction: Solana.ParsedTransactionWithMeta,
    tokenInstruction: Partial<SolanaTokenInstructionsDto>,
  ) {
    const authority = tokenInstruction.authority;
    if (!authority) return;

    const tokenBalances = parsedTransaction.meta.postTokenBalances;

    const sourceTokenBalance = tokenBalances.find((b) => b.owner === authority);
    const destinationTokenBalance = tokenBalances.find(
      (b) => b.owner !== authority && b.mint === sourceTokenBalance?.mint,
    );

    tokenInstruction.source = sourceTokenBalance.owner;
    tokenInstruction.destination = destinationTokenBalance.owner;
    tokenInstruction.mint = destinationTokenBalance.mint;
  }
}
