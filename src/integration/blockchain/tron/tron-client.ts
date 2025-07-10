import { Tron } from '@tatumio/tatum';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { TronTransactionMapper } from './dto/tron-transaction.mapper';
import {
  TronAddressResourcesDto,
  TronChainParameterDto,
  TronResourceDto,
  TronToken,
  TronTransactionDto,
  TronTransactionResponse,
} from './dto/tron.dto';
import { TronWallet } from './tron-wallet';
import { TronUtil } from './tron.util';

export class TronClient extends BlockchainClient {
  private readonly randomReceiverAddress = 'TQDxzX9KXA2tWp1qBjyiocwipKabnE2s8t';

  private readonly wallet: TronWallet;

  private readonly tokens = new AsyncCache<TronToken>();

  constructor(private readonly http: HttpService, private readonly tatumSdk: Tron) {
    super();

    this.wallet = TronWallet.createWithMnemonic(Config.blockchain.tron.tronWalletSeed);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  async getBlockHeight(): Promise<number> {
    return this.tatumSdk.rpc.getNowBlock().then((nb) => nb.block_header.raw_data.number);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.getWalletAddress());
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const addressBalanceResponse = await this.tatumSdk.address.getBalance({ address });
    if (addressBalanceResponse.error) throw new Error(`Cannot detect native coin balance of address ${address}`);

    const allAddressBalanceCoinData = addressBalanceResponse.data.filter(
      (d) => d.asset === 'TRX' && Util.equalsIgnoreCase(d.type, 'native'),
    );

    return Util.sum(allAddressBalanceCoinData.map((d) => TronUtil.fromSunAmount(d.balance, d.decimals)));
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset], address);

    return tokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.getWalletAddress();

    const addressBalanceResponse = await this.tatumSdk.address.getBalance({ address: owner });
    if (addressBalanceResponse.error) throw new Error(`Cannot detect token balances of owner ${owner}`);

    const assetAddresses = assets.map((a) => a.chainId);

    const allAddressBalanceTokenData = addressBalanceResponse.data.filter((d) =>
      Util.includesIgnoreCase(assetAddresses, d.tokenAddress),
    );

    const tokenBalances: BlockchainTokenBalance[] = [];

    for (const asset of assets) {
      const addressBalance = allAddressBalanceTokenData.find((d) =>
        Util.equalsIgnoreCase(d.tokenAddress, asset.chainId),
      );

      if (addressBalance) {
        const balance = TronUtil.fromSunAmount(addressBalance.balance, addressBalance.decimals);
        tokenBalances.push({ owner, contractAddress: asset.chainId, balance });
      }
    }

    return tokenBalances;
  }

  async isTxComplete(txHash: string, confirmations = 0): Promise<boolean> {
    const transaction = await this.getTransaction(txHash);
    if (!Util.equalsIgnoreCase(transaction.status, 'SUCCESS')) throw new Error(`Transaction ${txHash} has failed`);

    const currentConfirmations = (await this.getBlockHeight()) - (transaction.blockNumber ?? Number.MAX_VALUE);
    return currentConfirmations > confirmations;
  }

  async getToken(asset: Asset): Promise<TronToken> {
    return this.getTokenByAddress(asset.chainId);
  }

  private async getTokenByAddress(address: string): Promise<TronToken> {
    return this.tokens.get(address, async () => {
      const decimals = await this.http
        .post<any>(
          Config.blockchain.tron.tronRpcUrl,
          {
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [
              {
                to: TronUtil.convertToEvmAddress(address),
                data: '0x313ce567', // keccak256 of "decimals()"
              },
              'latest',
            ],
            id: 1,
          },
          this.httpConfig(),
        )
        .then((r) => r.result);

      return new TronToken(address, Number(decimals));
    });
  }

  async getCurrentGasCostForCoinTransaction(address?: string): Promise<number> {
    const receiverAddress = address ?? this.randomReceiverAddress;

    const chainParameter = await this.getChainParameter();

    let gasCost = (await this.isAccountActivated(address))
      ? 0
      : chainParameter.createAccountFee + chainParameter.createAccountBandwidthFee;

    const addressResources = await this.getAddressResources(receiverAddress);

    if (addressResources.bandwidth < Config.blockchain.tron.coinTransferBandwidth) {
      gasCost += Config.blockchain.tron.coinTransferBandwidth * chainParameter.bandwidthUnitPrice;
    }

    return Util.round(gasCost, 6);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, address?: string): Promise<number> {
    const receiverAddress = address ?? this.randomReceiverAddress;

    const chainParameter = await this.getChainParameter();

    let gasCost = (await this.isAccountActivated(address))
      ? 0
      : chainParameter.createAccountFee + chainParameter.createAccountBandwidthFee;

    const addressResources = await this.getAddressResources(receiverAddress);

    const tokenBandwidth = await this.getTokenBandwidth(token, receiverAddress);

    const bandwidthFeeInTrx = (tokenBandwidth - addressResources.bandwidth) * chainParameter.bandwidthUnitPrice;

    gasCost += Math.max(bandwidthFeeInTrx, 0);

    const transferEnergy =
      token.uniqueName === 'Tron/USDT'
        ? Config.blockchain.tron.usdtTransferEnergy
        : Config.blockchain.tron.tokenTransferEnergy;

    const feeInTrx = (transferEnergy - addressResources.energy) * chainParameter.energyUnitPrice;

    gasCost += Math.max(feeInTrx, 0);

    return Util.round(gasCost, 6);
  }

  async isAccountActivated(address: string): Promise<boolean> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const getAccountResponse = await this.http.post<any>(
      `${url}/wallet/getaccount`,
      {
        address,
        visible: true,
      },
      this.httpConfig(),
    );

    return getAccountResponse && Object.keys(getAccountResponse).length > 0;
  }

  private async getAddressResources(address: string): Promise<TronAddressResourcesDto> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const accountResourceResponse = await this.http.post<TronResourceDto>(
      `${url}/wallet/getaccountresource`,
      {
        address,
        visible: true,
      },
      this.httpConfig(),
    );

    return {
      bandwidth: accountResourceResponse.freeNetLimit ?? accountResourceResponse.NetLimit ?? 0,
      energy: accountResourceResponse.EnergyLimit ?? 0,
    };
  }

  private async getTokenBandwidth(token: Asset, address: string): Promise<number> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const triggersmartcontractResponse = await this.http.post<any>(
      `${url}/wallet/triggersmartcontract`,
      {
        owner_address: address,
        contract_address: token.chainId,
        function_selector: 'transfer(address,uint256)',
        parameter:
          '00000000000000000000004115208EF33A926919ED270E2FA61367B2DA3753DA0000000000000000000000000000000000000000000000000000000000000032',
        fee_limit: 10000000,
        call_value: 0,
        visible: true,
      },
      this.httpConfig(),
    );

    return (
      triggersmartcontractResponse.transaction.raw_data_hex.length / 2 + Config.blockchain.tron.tokenTransferBandwidth
    );
  }

  private async getChainParameter(): Promise<TronChainParameterDto> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const chainParameters = await this.http
      .get<{ chainParameter: { key: string; value: number }[] }>(`${url}/wallet/getchainparameters`, this.httpConfig())
      .then((r) => r.chainParameter);

    const chainParameterMap: Map<string, number> = new Map(chainParameters.map((cp) => [cp.key, cp.value]));

    const transactionFeeParameter = chainParameterMap.get('getTransactionFee');
    const energyFeeParameter = chainParameterMap.get('getEnergyFee');
    const createAccountFeeParameter = chainParameterMap.get('getCreateAccountFee');
    const createNewAccountFeeInSystemContractParameter = chainParameterMap.get(
      'getCreateNewAccountFeeInSystemContract',
    );

    return {
      bandwidthUnitPrice: TronUtil.fromSunAmount(transactionFeeParameter),
      energyUnitPrice: TronUtil.fromSunAmount(energyFeeParameter),
      createAccountFee: TronUtil.fromSunAmount(createAccountFeeParameter),
      createAccountBandwidthFee: TronUtil.fromSunAmount(createNewAccountFeeInSystemContractParameter),
    };
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = TronUtil.createWallet(account);
    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount);
  }

  private async sendNativeCoin(wallet: TronWallet, toAddress: string, amount: number): Promise<string> {
    const url = Config.blockchain.tron.tronApiUrl;

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
    const wallet = TronUtil.createWallet(account);
    return this.sendToken(wallet, toAddress, token, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.sendToken(this.wallet, toAddress, token, amount);
  }

  private async sendToken(wallet: TronWallet, toAddress: string, token: Asset, amount: number): Promise<string> {
    const url = Config.blockchain.tron.tronApiUrl;

    return this.http
      .post<any>(
        `${url}/trc20/transaction`,
        {
          fromPrivateKey: wallet.privateKey,
          to: toAddress,
          tokenAddress: token.chainId,
          amount: amount.toString(),
          feeLimit: TronUtil.fromSunAmount(Config.blockchain.tron.sendTokenFeeLimit),
        },
        this.httpConfig(),
      )
      .then((r) => r.txId);
  }

  async sendSignedTransaction(tx: string): Promise<BlockchainSignedTransactionResponse> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const broadcasthexResponse = await this.http.post<any>(
      `${url}/wallet/broadcasthex`,
      { transaction: tx },
      this.httpConfig(),
    );

    if (broadcasthexResponse.Error) {
      return {
        error: { message: broadcasthexResponse.Error },
      };
    }

    // TODO: Hier habe ich nur mal angenommen, dass es die "txId" ist ...
    // ... ausprobieren konnte ich es bisher leider noch nicht!
    return {
      hash: broadcasthexResponse.txId,
    };
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const transaction = await this.getTransaction(txHash);
    return TronUtil.fromSunAmount(transaction.fee ?? 0);
  }

  async getTransaction(txHash: string): Promise<TronTransactionDto | undefined> {
    const url = Config.blockchain.tron.tronApiUrl;

    return this.http
      .get<TronTransactionResponse>(`${url}/transaction/${txHash}`, this.httpConfig())
      .then((tr) => TronTransactionMapper.toTransactionDto(tr));
  }

  async getHistory(_limit: number): Promise<TronTransactionDto[]> {
    const url = Config.blockchain.tron.tronApiUrl;

    const transactions = await this.http
      .get<{ transactions: TronTransactionResponse[] }>(
        `${url}/transaction/account/${this.wallet.address}`,
        this.httpConfig(),
      )
      .then((r) => TronTransactionMapper.toTransactionDtos(r.transactions));

    const transactionIds = transactions.map((t) => t.txId);

    const trc20Transfers = await this.http
      .get<{ transactions: any[] }>(`${url}/transaction/account/${this.wallet.address}/trc20`, this.httpConfig())
      .then((r) => r.transactions);

    const trc20TxIds = trc20Transfers.map((t) => t.txID) as string[];

    for (const trc20TxId of trc20TxIds) {
      if (!transactionIds.includes(trc20TxId)) {
        const trc20Transaction = await this.getTransaction(trc20TxId);
        if (trc20Transaction) transactions.push(trc20Transaction);
      }
    }

    transactions.sort((t1, t2) => t2.timestamp - t1.timestamp);

    return transactions;
  }

  // --- HELPER METHODS --- //
  private httpConfig(): HttpRequestConfig {
    return {
      headers: {
        'x-api-key': Config.blockchain.tron.tronApiKey,
        'Content-Type': 'application/json',
      },
    };
  }
}
