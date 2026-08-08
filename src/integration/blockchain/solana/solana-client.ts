import * as SolanaToken from '@solana/spl-token';
import * as Solana from '@solana/web3.js';
import { Config, GetConfig } from 'src/config/config';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient, BlockchainToken } from '../shared/util/blockchain-client';
import {
  SolanaNativeInstructionsDto,
  SolanaTokenDto,
  SolanaTransactionDestinationDto,
  SolanaTransactionDto,
} from './dto/solana.dto';
import { SolanaWallet } from './solana-wallet';
import { SolanaUtil } from './solana.util';
import { TransactionRevertedException } from 'src/integration/blockchain/shared/exceptions/transaction-reverted.exception';

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

  private readonly tokens = new AsyncCache<BlockchainToken>();

  constructor(private readonly http: HttpService) {
    super();

    const { solanaGatewayUrl, solanaApiKey, solanaWalletSeed } = GetConfig().blockchain.solana;
    this.url = `${solanaGatewayUrl}/${solanaApiKey ?? ''}`;

    this.connection = new Solana.Connection(this.url);
    this.wallet = SolanaWallet.create(solanaWalletSeed);
  }

  get walletAddress(): string {
    return this.wallet.address;
  }

  // without a Tatum API key the gateway serves the anonymous tier, which rejects getBalance
  get isConfigured(): boolean {
    return !!Config.blockchain.solana.solanaApiKey;
  }

  async getBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight();
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
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

    const owner = address ?? this.walletAddress;

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

      throw new TransactionRevertedException(txHash);
    }

    return false;
  }

  private async getTokenByAddress(address: string): Promise<BlockchainToken> {
    return this.tokens.get(address, async () => {
      const mintAccount = await SolanaToken.getMint(this.connection, new Solana.PublicKey(address));
      const mintAddress = mintAccount.address.toBase58();
      const decimals = mintAccount.decimals;
      return new BlockchainToken(mintAddress, decimals);
    });
  }

  private async sendTransaction(wallet: SolanaWallet, transaction: Solana.Transaction): Promise<string> {
    wallet.signTransaction(transaction);

    const hexTransaction = transaction.serialize().toString('hex');

    // Broadcast boundary: the RPC call has already been made at this point, so a rejection here is
    // ambiguous (skipPreflight means the node may have accepted and relayed the tx before erroring).
    const result = await this.sendSignedTransaction(hexTransaction);
    if (result.error) throw new TxBroadcastError(result.error.message, { cause: result.error });
    // A JSON-RPC response with HTTP 200 can still omit the hash (falsy result.error) - fail-closed
    // explicitly instead of relying on pendingPayout(undefined) to reject implicitly downstream.
    if (!result.hash) throw new TxBroadcastError('Broadcast returned an empty tx hash', { cause: result });

    return result.hash;
  }

  async sendSignedTransaction(hex: string): Promise<BlockchainSignedTransactionResponse> {
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
          lamports: SolanaUtil.toLamportAmount(amount),
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

    const transaction = new Solana.Transaction();

    transaction.add(
      SolanaToken.createAssociatedTokenAccountIdempotentInstruction(
        fromPublicKey,
        toTokenAccount,
        toPublicKey,
        mintPublicKey,
      ),
    );

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

  // §2.3 native-first exactness (issue #4287): the EXACT on-chain tx fee as integer LAMPORTS — the raw meta.fee, BEFORE
  // the fromLamportAmount float collapse in getTransaction — i.e. SOL base units at the 9-dp lamports scale, so the
  // ledger books the payout network-fee leg exact. Fails LOUD on a missing tx/meta (the caller wraps it fail-open).
  async getTxActualFeeBaseUnits(txHash: string): Promise<bigint> {
    const parsedTransaction = await this.connection.getParsedTransaction(txHash, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    return BigInt(parsedTransaction.meta.fee);
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
      transaction.destinations.push(...(await this.getTokenTransactionDestinations(parsedTransaction)));
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

  // Emit one destination per SPL transfer/transferChecked instruction in the tx, so a single tx
  // that bundles unrelated instructions cannot glue DFX's ATA (from a `create`) to a foreign
  // transfer's amount (BUG-1260 parser bypass). Resolves each destination ATA to its owner via
  // postTokenBalances so callers can match on wallet-owner equality. Non-transfer instructions
  // (`create`, `closeAccount`) are ignored — they don't move asset value; a real "create and fund"
  // tx also has a transfer that carries the destination + amount.
  private async getTokenTransactionDestinations(
    parsedTransaction: Solana.ParsedTransactionWithMeta,
  ): Promise<SolanaTransactionDestinationDto[]> {
    const parsedInstructions = parsedTransaction.transaction.message.instructions as Solana.ParsedInstruction[];
    const accountKeys = parsedTransaction.transaction.message.accountKeys;
    const postTokenBalances = parsedTransaction.meta.postTokenBalances ?? [];

    const destinations: SolanaTransactionDestinationDto[] = [];

    for (const instruction of parsedInstructions) {
      const info = instruction.parsed?.info;
      if (!info) continue;

      const type = instruction.parsed.type;
      if (type !== 'transfer' && type !== 'transferChecked') continue;

      const destinationAta: string | undefined = info.destination;
      const rawAmount: string | number | undefined =
        type === 'transferChecked' ? info.tokenAmount?.amount : info.amount;
      if (!destinationAta || rawAmount == null) continue;

      const destinationBalance = postTokenBalances.find(
        (b) => accountKeys[b.accountIndex]?.pubkey.toBase58() === destinationAta,
      );
      if (!destinationBalance?.mint || !destinationBalance?.owner) continue;

      const token = await this.getTokenByAddress(destinationBalance.mint);

      destinations.push({
        to: destinationBalance.owner,
        amount: SolanaUtil.fromLamportAmount(rawAmount, token.decimals),
        tokenInfo: { address: destinationBalance.mint, decimals: token.decimals },
      });
    }

    return destinations;
  }
}
