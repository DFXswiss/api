import { ApiVersion, CardanoRosetta, Network as TatumNetwork, TatumSDK } from '@tatumio/tatum';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { CardanoWallet } from './cardano-wallet';
import { CardanoUtil } from './cardano.util';
import { CardanoTransactionMapper } from './dto/cardano-transaction.mapper';
import {
  CardanoChainParameterDto,
  CardanoTransactionDto,
  CardanoTransactionResponse,
  CardanoTransactionUtxosResponse,
} from './dto/cardano.dto';

export class CardanoClient extends BlockchainClient {
  private readonly wallet: CardanoWallet;

  private readonly networkIdentifier = { blockchain: 'cardano', network: 'mainnet' };

  private tatumSdk: CardanoRosetta;

  constructor(private readonly http: HttpService) {
    super();

    this.wallet = CardanoWallet.createFromMnemonic(Config.blockchain.cardano.cardanoWalletSeed);
  }

  get walletAddress(): string {
    return this.wallet.address;
  }

  async getBlockHeight(): Promise<number> {
    const tatumSdk = await this.getTatumSdk();
    const networkStatus = await tatumSdk.rpc.getNetworkStatus({
      networkIdentifier: this.networkIdentifier,
    });
    return networkStatus.current_block_identifier.index;
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const tatumSdk = await this.getTatumSdk();
    const accountBalance = await tatumSdk.rpc.getAccountBalance({
      networkIdentifier: this.networkIdentifier,
      accountIdentifier: { address },
    });

    const adaBalance = accountBalance.balances.find((b) => b.currency.symbol === 'ADA');
    if (!adaBalance) return 0;

    return CardanoUtil.fromLovelaceAmount(adaBalance.value, adaBalance.currency.decimals);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset], address);

    return tokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.walletAddress;

    const tatumSdk = await this.getTatumSdk();
    const accountBalance = await tatumSdk.rpc.getAccountBalance({
      networkIdentifier: this.networkIdentifier,
      accountIdentifier: { address: owner },
    });

    const tokenBalances: BlockchainTokenBalance[] = [];

    for (const asset of assets) {
      // Cardano native tokens use policy_id.asset_name format
      const tokenBalance = accountBalance.balances.find(
        (b) => b.currency.symbol === asset.chainId || b.currency.metadata?.policyId === asset.chainId,
      );

      if (tokenBalance) {
        const balance = CardanoUtil.fromLovelaceAmount(tokenBalance.value, tokenBalance.currency.decimals);
        tokenBalances.push({ owner, contractAddress: asset.chainId, balance });
      }
    }

    return tokenBalances;
  }

  async isTxComplete(txHash: string, confirmations = 0): Promise<boolean> {
    const transaction = await this.getTransaction(txHash);

    const currentConfirmations = (await this.getBlockHeight()) - (transaction?.blockNumber ?? Number.MAX_VALUE);

    if (currentConfirmations > confirmations) {
      if (Util.equalsIgnoreCase(transaction.status, 'SUCCESS')) return true;

      throw new Error(`Transaction ${txHash} has failed`);
    }

    return false;
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const chainParameter = await this.getChainParameter();

    // Upper limit transaction size for a simple ADA transfer
    const maxTxSize = 400;
    const gasCost = chainParameter.minFeeA * maxTxSize + chainParameter.minFeeB;

    return Util.round(CardanoUtil.fromLovelaceAmount(gasCost), 6);
  }

  async getCurrentGasCostForTokenTransaction(_token: Asset): Promise<number> {
    const chainParameter = await this.getChainParameter();

    // Upper limit transaction size for token transfers
    const maxTxSize = 600;
    const gasCost = chainParameter.minFeeA * maxTxSize + chainParameter.minFeeB;

    return Util.round(CardanoUtil.fromLovelaceAmount(gasCost), 6);
  }

  private async getChainParameter(): Promise<CardanoChainParameterDto> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    const epochParams = await this.http.get<any>(`${url}/epochs/latest/parameters`, this.httpConfig());

    return {
      minFeeA: epochParams.min_fee_a,
      minFeeB: epochParams.min_fee_b,
      minPoolCost: epochParams.min_pool_cost,
      utxoCostPerByte: epochParams.price_mem,
    };
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = CardanoUtil.createWallet(account);
    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount);
  }

  private async sendNativeCoin(wallet: CardanoWallet, toAddress: string, amount: number): Promise<string> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .post<any>(
        `${url}/transaction`,
        {
          fromPrivateKey: wallet.privateKey,
          to: toAddress,
          amount: amount.toString(),
        },
        this.httpConfig(),
      )
      .then((r) => r.txId);
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number): Promise<string> {
    const wallet = CardanoUtil.createWallet(account);
    return this.sendToken(wallet, toAddress, token, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.sendToken(this.wallet, toAddress, token, amount);
  }

  private async sendToken(wallet: CardanoWallet, toAddress: string, token: Asset, amount: number): Promise<string> {
    if (!token.decimals) throw new Error(`No decimals found in token ${token.uniqueName}`);

    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .post<any>(
        `${url}/native-token/transaction`,
        {
          fromPrivateKey: wallet.privateKey,
          to: toAddress,
          tokenAddress: token.chainId,
          amount: Util.floor(amount, token.decimals).toString(),
        },
        this.httpConfig(),
      )
      .then((r) => r.txId);
  }

  async sendSignedTransaction(tx: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      const tatumSdk = await this.getTatumSdk();
      const response = await tatumSdk.rpc.submitTransaction({
        networkIdentifier: this.networkIdentifier,
        signedTransaction: tx,
      });

      return {
        hash: response.transaction_identifier.hash,
      };
    } catch (error) {
      return {
        error: { message: error.message || 'Transaction submission failed' },
      };
    }
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.getTransaction(txHash).then((t) => t.fee);
  }

  async getTransaction(txHash: string): Promise<CardanoTransactionDto | undefined> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .get<CardanoTransactionResponse>(`${url}/txs/${txHash}`, this.httpConfig())
      .then((tr) => CardanoTransactionMapper.toTransactionDto(tr, (hash) => this.getTransactionUtxos(hash)));
  }

  async getTransactionUtxos(txHash: string): Promise<CardanoTransactionUtxosResponse> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http.get<CardanoTransactionUtxosResponse>(`${url}/txs/${txHash}/utxos`, this.httpConfig());
  }

  async getHistory(_limit: number): Promise<CardanoTransactionDto[]> {
    return this.getHistoryForAddress(this.wallet.address, _limit);
  }

  async getHistoryForAddress(address: string, _limit: number): Promise<CardanoTransactionDto[]> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    const transactions = await this.http
      .get<CardanoTransactionResponse[]>(`${url}/addresses/${address}/transactions`, this.httpConfig())
      .then((txs) => CardanoTransactionMapper.toTransactionDtos(txs, (hash) => this.getTransactionUtxos(hash)));

    transactions.sort((t1, t2) => t2.timestamp - t1.timestamp);

    return transactions;
  }

  // --- HELPER METHODS --- //
  private async getTatumSdk(): Promise<CardanoRosetta> {
    if (!this.tatumSdk) {
      this.tatumSdk = await TatumSDK.init<CardanoRosetta>({
        version: ApiVersion.V3,
        network: TatumNetwork.CARDANO_ROSETTA,
        apiKey: Config.blockchain.cardano.cardanoApiKey,
      });
    }

    return this.tatumSdk;
  }

  private httpConfig(): HttpRequestConfig {
    return {
      headers: {
        'x-api-key': Config.blockchain.cardano.cardanoApiKey,
        'Content-Type': 'application/json',
      },
    };
  }
}
