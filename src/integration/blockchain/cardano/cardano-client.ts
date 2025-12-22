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
  private blockFrostApi: BlockFrostAPI;

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
    return this.estimateGasCost(400);
  }

  async getCurrentGasCostForTokenTransaction(_token: Asset): Promise<number> {
    return this.estimateGasCost(600);
  }

  private async estimateGasCost(maxTxSize: number): Promise<number> {
    const blockFrostApi = this.getBlockFrostAPI();
    const staticParameters = await this.networkParameterCache.get('static', () =>
      blockFrostApi.epochsLatestParameters(),
    );
    const gasCost = maxTxSize * staticParameters.min_fee_a + staticParameters.min_fee_b;
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
    const signedTransactionHex = await this.createSignedTransactionBlockFrost(wallet, toAddress, amount);

    const blockFrostApi = this.getBlockFrostAPI();
    return blockFrostApi.txSubmit(signedTransactionHex);
  }

  private async createSignedTransactionBlockFrost(
    wallet: CardanoWallet,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    try {
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
    } catch (e) {
      throw new Error(e);
    }
  }

  private async createTransactionBuilder(): Promise<TransactionBuilder> {
    const blockFrostApi = this.getBlockFrostAPI();
    const parameters = await blockFrostApi.epochsLatestParameters();

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

  private async createInputsBuilder(wallet: CardanoWallet): Promise<TxInputsBuilder> {
    const inputsBuilder = TxInputsBuilder.new();

    const blockFrostApi = this.getBlockFrostAPI();
    const utxos = await blockFrostApi.addressesUtxos(wallet.address);

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

  private async sendToken(_wallet: CardanoWallet, _toAddress: string, token: Asset, _amount: number): Promise<string> {
    if (!token.decimals) throw new Error(`No decimals found in token ${token.uniqueName}`);
    throw new Error('not implemented yet');
  }

  async sendSignedTransaction(tx: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      const blockFrostApi = this.getBlockFrostAPI();
      const txHash = await blockFrostApi.txSubmit(tx);

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

    return this.http
      .get<CardanoTransactionResponse>(`${url}/transaction/${txHash}`, this.httpConfig())
      .then((r) => this.mapTransactionResponses([r]))
      .then((l) => l[0]);
  }

  async getHistory(limit: number): Promise<CardanoTransactionDto[]> {
    return this.getHistoryForAddress(this.wallet.address, limit);
  }

  async getHistoryForAddress(address: string, limit: number): Promise<CardanoTransactionDto[]> {
    if (limit > 50) throw new Error('Max. Limit of 50 allowed');

    const url = Config.blockchain.cardano.cardanoApiUrl;

    return this.http
      .get<CardanoTransactionResponse[]>(
        `${url}/transaction/address/${address}?pageSize=${limit}&offset=0`,
        this.httpConfig(),
      )
      .then((trs) => this.mapTransactionResponses(trs));
  }

  private async mapTransactionResponses(
    transactionResponses: CardanoTransactionResponse[],
  ): Promise<CardanoTransactionDto[]> {
    // fetch all block timestamps
    const blockHashes = [...new Set(transactionResponses.map((tr) => tr.block.hash))];
    const blockInfos = await Promise.all(blockHashes.map((hash) => this.getBlockInfo(hash)));
    const blockTimestampMap = new Map(blockInfos.map((block) => [block.hash, new Date(block.forgedAt).getTime()]));

    return transactionResponses.map((tr) => {
      tr.block.blocktimeMillis = blockTimestampMap.get(tr.block.hash);
      return CardanoTransactionMapper.toTransactionDto(tr, this.wallet.address);
    });
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

  private getBlockFrostAPI(): BlockFrostAPI {
    if (!this.blockFrostApi) {
      this.blockFrostApi = new BlockFrostAPI({
        projectId: Config.blockchain.cardano.cardanoBlockFrostApiKey,
        network: 'mainnet',
      });
    }

    return this.blockFrostApi;
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
