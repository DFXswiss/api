import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import {
  Address,
  BigNum,
  LinearFee,
  make_vkey_witness,
  Transaction,
  TransactionBody,
  TransactionBuilder,
  TransactionBuilderConfigBuilder,
  TransactionHash,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  TransactionWitnessSet,
  TxInputsBuilder,
  Value,
  Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-nodejs';
import { ApiVersion, CardanoRosetta, Network as TatumNetwork, TatumSDK } from '@tatumio/tatum';
import blake from 'blakejs';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { CardanoWallet } from './cardano-wallet';
import { CardanoUtil } from './cardano.util';
import { CardanoTransactionMapper } from './dto/cardano-transaction.mapper';
import { CardanoBlockResponse, CardanoTransactionDto, CardanoTransactionResponse } from './dto/cardano.dto';

interface NetworkParameterStaticInfo {
  min_fee_a: number;
  min_fee_b: number;
}

export class CardanoClient extends BlockchainClient {
  private readonly wallet: CardanoWallet;

  private readonly networkIdentifier = { blockchain: 'cardano', network: 'mainnet' };

  private tatumSdk: CardanoRosetta;
  private blockfrostApi: BlockFrostAPI;

  private readonly networkParameterCache = new AsyncCache<NetworkParameterStaticInfo>(
    CacheItemResetPeriod.EVERY_24_HOURS,
  );

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
      return true;
    }

    return false;
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const maxTxSize = 400;

    const staticParameters = await this.networkParameterCache.get('static', () => this.getNetworkStaticParameters());
    const feePerByte = staticParameters.min_fee_a;
    const fixFee = staticParameters.min_fee_b;

    const gasCost = maxTxSize * feePerByte + fixFee;

    return Util.round(CardanoUtil.fromLovelaceAmount(gasCost), 6);
  }

  async getCurrentGasCostForTokenTransaction(_token: Asset): Promise<number> {
    const maxTxSize = 600;

    const staticParameters = await this.networkParameterCache.get('static', () => this.getNetworkStaticParameters());
    const feePerByte = staticParameters.min_fee_a;
    const fixFee = staticParameters.min_fee_b;

    const gasCost = maxTxSize * feePerByte + fixFee;

    return Util.round(CardanoUtil.fromLovelaceAmount(gasCost), 6);
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = CardanoUtil.createWallet(account);
    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount);
  }

  private async sendNativeCoin(wallet: CardanoWallet, toAddress: string, amount: number): Promise<string> {
    const coinBalance = await this.getNativeCoinBalanceForAddress(wallet.address);
    const fee = await this.getCurrentGasCostForCoinTransaction();
    const totalAmount = amount + fee;

    if (coinBalance < totalAmount) throw new Error(`Coin balance ${coinBalance} less than amount + fee ${totalAmount}`);

    const signedTransactionHex = await this.createSignedTransactionBlockfrost(wallet, toAddress, amount);

    const blockfrostApi = this.getBlockfrostAPI();
    return blockfrostApi.txSubmit(signedTransactionHex);
  }

  private async createSignedTransactionBlockfrost(
    wallet: CardanoWallet,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    const transactionBuilder = await this.createTransactionBuilder();
    const inputsBuilder = await this.createInputsBuilder(wallet);

    transactionBuilder.set_inputs(inputsBuilder);

    transactionBuilder.add_output(
      TransactionOutput.new(
        Address.from_bech32(toAddress),
        Value.new(BigNum.from_str(`${CardanoUtil.toLovelaceAmount(amount)}`)),
      ),
    );

    transactionBuilder.add_change_if_needed(Address.from_bech32(wallet.address));

    const transactionBody = transactionBuilder.build();

    const witnessSet = this.createWitnessSet(transactionBody, wallet);

    const signedTransaction = Transaction.new(transactionBody, witnessSet, null);
    return signedTransaction.to_hex();
  }

  private async createTransactionBuilder(): Promise<TransactionBuilder> {
    const blockfrostApi = this.getBlockfrostAPI();
    const parameters = await blockfrostApi.epochsLatestParameters();

    return TransactionBuilder.new(
      TransactionBuilderConfigBuilder.new()
        .fee_algo(
          LinearFee.new(
            BigNum.from_str(parameters.min_fee_a.toString()),
            BigNum.from_str(parameters.min_fee_b.toString()),
          ),
        )
        .coins_per_utxo_byte(BigNum.from_str(parameters.coins_per_utxo_size))
        .key_deposit(BigNum.from_str(parameters.key_deposit))
        .pool_deposit(BigNum.from_str(parameters.pool_deposit))
        .max_tx_size(parameters.max_tx_size)
        .max_value_size(Number(parameters.max_val_size))
        .build(),
    );
  }

  private async getNetworkStaticParameters(): Promise<NetworkParameterStaticInfo> {
    const blockfrostApi = this.getBlockfrostAPI();
    return blockfrostApi.epochsLatestParameters();
  }

  private async createInputsBuilder(wallet: CardanoWallet): Promise<TxInputsBuilder> {
    const inputsBuilder = TxInputsBuilder.new();

    const blockfrostApi = this.getBlockfrostAPI();
    const utxos = await blockfrostApi.addressesUtxos(wallet.address);

    utxos.forEach((utxo) => {
      const input = TransactionInput.new(
        TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
        utxo.output_index,
      );

      const output = TransactionOutput.new(
        Address.from_bech32(wallet.address),
        Value.new(BigNum.from_str(utxo.amount[0].quantity)),
      );

      inputsBuilder.add_regular_utxo(TransactionUnspentOutput.new(input, output));
    });

    return inputsBuilder;
  }

  private createWitnessSet(txBody: TransactionBody, wallet: CardanoWallet): TransactionWitnessSet {
    const witnessSet = TransactionWitnessSet.new();

    const txBodyBytes = txBody.to_bytes();
    const hashBuffer = blake.blake2b(txBodyBytes, null, 32);
    const txHash = TransactionHash.from_bytes(Buffer.from(hashBuffer));

    const vkeyWitnesses = Vkeywitnesses.new();
    vkeyWitnesses.add(make_vkey_witness(txHash, wallet.paymentKey.to_raw_key()));

    witnessSet.set_vkeys(vkeyWitnesses);

    return witnessSet;
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
    throw new Error('not implemented yet');
  }

  async sendSignedTransaction(tx: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      const blockfrostApi = this.getBlockfrostAPI();
      const txHash = await blockfrostApi.txSubmit(tx);

      return {
        hash: txHash,
      };
    } catch (error) {
      return {
        error: { message: error.message || 'Transaction submission failed' },
      };
    }
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .get<CardanoTransactionResponse>(`${url}/transaction/${txHash}`, this.httpConfig())
      .then((t) => CardanoUtil.fromLovelaceAmount(t.fee));
  }

  async getTransaction(txHash: string): Promise<CardanoTransactionDto> {
    const url = Config.blockchain.cardano.cardanoApiUrl;

    const xxx = await this.http.get<CardanoTransactionResponse>(`${url}/transaction/${txHash}`, this.httpConfig());
    await this.getBlockInfo(xxx.block.hash);

    return this.http
      .get<CardanoTransactionResponse>(`${url}/transaction/${txHash}`, this.httpConfig())
      .then((tr) => this.mapTransactionResponse(tr));
  }

  async getHistory(limit: number): Promise<CardanoTransactionDto[]> {
    if (limit > 50) throw new Error('Max. Limit of 50 allowed');

    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .get<CardanoTransactionResponse[]>(
        `${url}/transaction/address/${this.wallet.address}?pageSize=${limit}&offset=0`,
        this.httpConfig(),
      )
      .then((trs) => this.mapTransactionResponses(trs));
  }

  private async mapTransactionResponses(
    transactionResponses: CardanoTransactionResponse[],
  ): Promise<CardanoTransactionDto[]> {
    const result: CardanoTransactionDto[] = [];

    for (const transactionResponse of transactionResponses) {
      result.push(await this.mapTransactionResponse(transactionResponse));
    }

    return result;
  }

  private async mapTransactionResponse(
    transactionResponse: CardanoTransactionResponse,
  ): Promise<CardanoTransactionDto> {
    const blockInfo = await this.getBlockInfo(transactionResponse.block.hash);
    transactionResponse.block.blocktimeMillis = new Date(blockInfo.forgedAt).getTime();

    return CardanoTransactionMapper.toTransactionDto(transactionResponse, this.wallet.address);
  }

  private async getBlockInfo(blockHash: string): Promise<CardanoBlockResponse> {
    const url = Config.blockchain.cardano.cardanoApiUrl;
    return this.http.get<CardanoBlockResponse>(`${url}/block/${blockHash}`, this.httpConfig());
  }

  // --- HELPER METHODS --- //
  private async getTatumSdk(): Promise<CardanoRosetta> {
    if (!this.tatumSdk) {
      this.tatumSdk = await TatumSDK.init<CardanoRosetta>({
        version: ApiVersion.V3,
        network: TatumNetwork.CARDANO_ROSETTA,
        apiKey: Config.blockchain.cardano.cardanoTatumApiKey,
      });
    }

    return this.tatumSdk;
  }

  private getBlockfrostAPI(): BlockFrostAPI {
    if (!this.blockfrostApi) {
      this.blockfrostApi = new BlockFrostAPI({
        projectId: Config.blockchain.cardano.cardanoBlockfrostApiKey,
        network: 'mainnet',
      });
    }

    return this.blockfrostApi;
  }

  private httpConfig(): HttpRequestConfig {
    return {
      headers: {
        'x-api-key': Config.blockchain.cardano.cardanoTatumApiKey,
        'Content-Type': 'application/json',
      },
    };
  }
}
