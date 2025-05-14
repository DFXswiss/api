import * as SolanaToken from '@solana/spl-token';
import * as Solana from '@solana/web3.js';
import { Currency, Token } from '@uniswap/sdk-core';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SolanaSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { SolanaTokenDto, SolanaTransactionDto } from './dto/solana.dto';
import { SolanaWallet } from './solana-wallet';
import { SolanaUtil } from './SolanaUtil';

const TRANSFER_TYPES = ['transfer', 'transferchecked'];

export class SolanaClient extends BlockchainClient {
  private readonly randomReceiverAddress = '3f5tFNkZDjGCjrkNRfLNE5Cr648H1yyCDdfYGHVcRqRV';

  private readonly url: string;

  private readonly wallet: SolanaWallet;
  private readonly connection: Solana.Connection;

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

    for (const asset of assets) {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        new Solana.PublicKey(address ?? this.getWalletAddress()),
        {
          mint: new Solana.PublicKey(asset.chainId),
        },
        'confirmed',
      );

      for (const tokenAccount of tokenAccounts.value) {
        const info = tokenAccount.account.data.parsed.info;
        const tokenAmount = info.tokenAmount;

        const balance = SolanaUtil.fromLamportAmount(tokenAmount.amount, tokenAmount.decimals);
        tokenBalances.push({ contractAddress: info.mint, balance: balance });
      }
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

  async getToken(asset: Asset): Promise<Currency> {
    return this.getTokenByAddress(asset.chainId);
  }

  private async getTokenByAddress(address: string): Promise<Token> {
    const mintAccount = await SolanaToken.getMint(this.connection, new Solana.PublicKey(address));
    const mintAddress = mintAccount.address.toBase58();
    const decimals = mintAccount.decimals;

    return new Token(-1, mintAddress, decimals);
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
    wallet.signTransaction(transaction);

    const hexTransaction = transaction.serialize().toString('hex');

    const result = await this.sendSignedTransaction(hexTransaction);
    if (result.error) throw new Error(result.error.message);

    return result.hash;
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
    const transaction = await this.createTokenTransaction(wallet, token.chainId, toAddress, amount);
    wallet.signTransaction(transaction);

    const hexTransaction = transaction.serialize().toString('hex');

    const result = await this.sendSignedTransaction(hexTransaction);
    if (result.error) throw new Error(result.error.message);

    return result.hash;
  }

  private async createTokenTransaction(
    wallet: SolanaWallet,
    mintAddress: string,
    toAddress: string,
    amount: number,
  ): Promise<Solana.Transaction> {
    const keypair = wallet.keypair;

    const sourceAccount = await SolanaToken.getOrCreateAssociatedTokenAccount(
      this.connection,
      keypair,
      new Solana.PublicKey(mintAddress),
      keypair.publicKey,
    );

    const destinationAccount = await SolanaToken.getOrCreateAssociatedTokenAccount(
      this.connection,
      keypair,
      new Solana.PublicKey(mintAddress),
      new Solana.PublicKey(toAddress),
    );

    const info = await this.connection.getParsedAccountInfo(new Solana.PublicKey(mintAddress));
    const decimals = (info.value?.data as Solana.ParsedAccountData).parsed.info.decimals as number;

    const transaction = new Solana.Transaction()
      .add(
        SolanaToken.createTransferInstruction(
          sourceAccount.address,
          destinationAccount.address,
          keypair.publicKey,
          amount * Math.pow(10, decimals),
        ),
      )
      .add(this.calculatePriorityFee());

    const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockHash.blockhash;

    return transaction;
  }

  private calculatePriorityFee(): Solana.TransactionInstruction {
    const priorityRate = 100;
    return Solana.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityRate });
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const amount = 10 / Solana.LAMPORTS_PER_SOL;
    const transaction = await this.createNativeCoinTransaction(this.wallet, this.randomReceiverAddress, amount);

    const response = await this.connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    const feeInLamports = response.value;

    return SolanaUtil.fromLamportAmount(feeInLamports);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const amount = 10 / Solana.LAMPORTS_PER_SOL;
    const transaction = await this.createTokenTransaction(
      this.wallet,
      token.chainId,
      this.randomReceiverAddress,
      amount,
    );

    const response = await this.connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    const feeInLamports = response.value;

    return SolanaUtil.fromLamportAmount(feeInLamports);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.getTransaction(txHash).then((t) => t[0]?.fee ?? 0);
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

    const walletInfo = await this.createWalletInfo();

    const allSignatures = await this.connection
      .getSignaturesForAddress(walletInfo.publicKey, { limit }, 'finalized')
      .then((s) => s.map((s) => s.signature));

    const allParsedTransactions = await this.connection.getParsedTransactions(allSignatures, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });

    for (const parsedTransaction of allParsedTransactions) {
      history.push(await this.createTransactionDto(parsedTransaction));
    }

    return history;
  }

  private async createWalletInfo(): Promise<{
    publicKey: Solana.PublicKey;
    walletAddress: string;
    allAddresses: string[];
    allTokens: SolanaTokenDto[];
  }> {
    const publicKey = this.wallet.publicKey;
    const walletAddress = publicKey.toBase58();

    const allTokens = await this.getAllTokens(walletAddress);
    const allTokenAddresses = allTokens.map((t) => t.address);

    const allAddresses = [walletAddress, ...allTokenAddresses];

    return {
      publicKey,
      walletAddress,
      allAddresses,
      allTokens,
    };
  }

  private async createTransactionDto(
    parsedTransaction: Solana.ParsedTransactionWithMeta,
  ): Promise<SolanaTransactionDto> {
    const accountKeys = parsedTransaction.transaction.message.accountKeys;
    const messageAccount = accountKeys.find((ak) => ak.signer && ak.source === 'transaction');
    const signer = messageAccount.pubkey.toBase58();

    const transaction: SolanaTransactionDto = {
      slotNumber: parsedTransaction.slot,
      blocktime: parsedTransaction.blockTime,
      txid: parsedTransaction.transaction.signatures[0],
      from: signer,
      fee: SolanaUtil.fromLamportAmount(parsedTransaction.meta.fee),
      destinations: [],
    };

    const instructions = parsedTransaction.transaction.message.instructions as Solana.ParsedInstruction[];
    const transferInstructions = instructions.filter((i) => TRANSFER_TYPES.includes(i.parsed?.type.toLowerCase()));

    const instructionInfos = transferInstructions
      .filter((ti) => ti.parsed.info)
      .map((ti) => ({
        destination: ti.parsed.info.destination as string,
        lamports: ti.parsed.info.lamports as number,
        source: ti.parsed.info.source as string,
        amount: ti.parsed.info.amount as string,
        authority: ti.parsed.info.authority as string,
      }));

    const destinationsOfSigner = instructionInfos.filter((ii) => ii.source === signer || ii.authority === signer);

    for (const destination of destinationsOfSigner) {
      transaction.destinations.push({
        to: destination.destination,
        amount: SolanaUtil.fromLamportAmount(destination.lamports),
      });
    }

    return transaction;
  }
}
