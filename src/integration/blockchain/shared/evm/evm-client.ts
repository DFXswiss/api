import { ChainId, Currency, CurrencyAmount, Ether, NativeCurrency, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, SwapOptions, SwapRoute, SwapType } from '@uniswap/smart-order-router';
import { buildSwapMethodParameters } from '@uniswap/smart-order-router/build/main/util/methodParameters';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import QuoterV2ABI from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json';
import { FeeAmount, MethodParameters, Pool, Route, SwapQuoter, Trade } from '@uniswap/v3-sdk';
import { AssetTransfersCategory, AssetTransfersWithMetadataResult, BigNumberish } from 'alchemy-sdk';
import BigNumber from 'bignumber.js';
import { Contract, BigNumber as EthersNumber, ethers } from 'ethers';
import { hashMessage } from 'ethers/lib/utils';
import { AlchemyService, AssetTransfersParams } from 'src/integration/alchemy/services/alchemy.service';
import ERC1271_ABI from 'src/integration/blockchain/shared/evm/abi/erc1271.abi.json';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import SIGNATURE_TRANSFER_ABI from 'src/integration/blockchain/shared/evm/abi/signature-transfer.abi.json';
import UNISWAP_V3_NFT_MANAGER_ABI from 'src/integration/blockchain/shared/evm/abi/uniswap-v3-nft-manager.abi.json';
import { BlockscoutService } from 'src/integration/blockchain/shared/blockscout/blockscout.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { UnsignedTxDto } from 'src/subdomains/core/sell-crypto/route/dto/unsigned-tx.dto';
import { BlockchainTokenBalance } from '../dto/blockchain-token-balance.dto';
import { EvmSignedTransactionResponse } from '../dto/signed-transaction-reponse.dto';
import { BlockchainClient } from '../util/blockchain-client';
import { WalletAccount } from './domain/wallet-account';
import { EvmUtil } from './evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

export interface EvmClientParams {
  http: HttpService;
  alchemyService?: AlchemyService;
  blockscoutService?: BlockscoutService;
  blockscoutApiUrl?: string;
  gatewayUrl: string;
  apiKey: string;
  walletPrivateKey: string;
  chainId: ChainId;
  swapContractAddress?: string;
  quoteContractAddress?: string;
  swapFactoryAddress?: string;
  swapGatewayAddress?: string;
}

interface UniswapPosition {
  token0: string;
  token1: string;
  fee: FeeAmount;
  tickLower: number;
  tickUpper: number;
  liquidity: EthersNumber;
}

export enum Direction {
  BOTH = 'both',
  OUTGOING = 'outgoing',
  INCOMING = 'incoming',
}

export abstract class EvmClient extends BlockchainClient {
  protected readonly logger = new DfxLogger(EvmClient);

  readonly http: HttpService;
  private readonly alchemyService: AlchemyService;
  protected readonly blockscoutService?: BlockscoutService;
  protected readonly blockscoutApiUrl?: string;
  readonly chainId: ChainId;

  protected provider: ethers.providers.JsonRpcProvider;
  protected randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';
  readonly wallet: ethers.Wallet;
  private readonly nonce = new Map<string, { value: number; date: Date }>();
  private readonly tokens = new AsyncCache<Token>();
  private readonly router: AlphaRouter;
  private readonly swapContractAddress: string;
  private readonly swapFactoryAddress: string;
  private readonly quoteContractAddress: string;
  protected readonly swapGatewayAddress: string;

  constructor(params: EvmClientParams) {
    super();
    this.http = params.http;
    this.alchemyService = params.alchemyService;
    this.blockscoutService = params.blockscoutService;
    this.blockscoutApiUrl = params.blockscoutApiUrl;
    this.chainId = params.chainId;

    const url = `${params.gatewayUrl}/${params.apiKey ?? ''}`;
    this.provider = new ethers.providers.StaticJsonRpcProvider(url, this.chainId);

    this.wallet = new ethers.Wallet(params.walletPrivateKey, this.provider);

    if (params.swapContractAddress) {
      this.router = new AlphaRouter({
        chainId: this.chainId,
        provider: this.provider,
      });
    }

    this.swapContractAddress = params.swapContractAddress;
    this.quoteContractAddress = params.quoteContractAddress;
    this.swapFactoryAddress = params.swapFactoryAddress;
    this.swapGatewayAddress = params.swapGatewayAddress;
  }

  // --- PUBLIC API - GETTERS --- //

  async getNativeCoinTransactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    const categories = this.alchemyService.getNativeCoinCategories(this.chainId);

    return this.getHistory(direction, walletAddress, categories, fromBlock, toBlock);
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    const categories = this.alchemyService.getERC20Categories(this.chainId);

    return this.getHistory(direction, walletAddress, categories, fromBlock, toBlock);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.alchemyService.getNativeCoinBalance(this.chainId, address);

    return EvmUtil.fromWeiAmount(balance);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const evmTokenBalances = await this.getTokenBalances([asset], address);

    return evmTokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.walletAddress;
    const evmTokenBalances: BlockchainTokenBalance[] = [];

    const tokenBalances = await this.alchemyService.getTokenBalances(this.chainId, owner, assets);

    for (const tokenBalance of tokenBalances) {
      const token = await this.getTokenByAddress(tokenBalance.contractAddress);
      const balance = EvmUtil.fromWeiAmount(tokenBalance.tokenBalance ?? 0, token.decimals);

      evmTokenBalances.push({ owner, contractAddress: tokenBalance.contractAddress, balance: balance });
    }

    return evmTokenBalances;
  }

  async getRecommendedGasPrice(): Promise<EthersNumber> {
    // 20% cap
    return this.provider.getGasPrice().then((p) => p.mul(12).div(10));
  }

  async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getTransactionCount(address: string): Promise<number> {
    return this.provider.getTransactionCount(address);
  }

  protected async getTokenGasLimitForAsset(token: Asset): Promise<EthersNumber> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.getTokenGasLimitForContact(contract, this.randomReceiverAddress);
  }

  async getTokenGasLimitForContact(contract: Contract, to: string, amount?: EthersNumber): Promise<EthersNumber> {
    // Use actual amount if provided, otherwise use 1 for gas estimation
    // Some tokens may have minimum transfer amounts or balance checks that fail with 1 Wei
    const estimateAmount = amount ?? 1;

    try {
      const gasEstimate = await contract.estimateGas.transfer(to, estimateAmount);
      return gasEstimate.mul(12).div(10);
    } catch (error) {
      // If gas estimation fails (e.g., from EIP-7702 delegated address), use a safe default
      // Standard ERC20 transfer is ~65k gas, using 100k as safe upper bound with buffer
      this.logger.verbose(
        `Gas estimation failed for token transfer to ${to}: ${error.message}. Using default gas limit of 100000`,
      );
      return ethers.BigNumber.from(100000);
    }
  }

  async prepareTransaction(
    asset: Asset,
    fromAddress: string,
    toAddress: string,
    amount: number,
  ): Promise<UnsignedTxDto> {
    const amountWei = EvmUtil.toWeiAmount(amount, asset.decimals);

    const [{ to, data, value, gasLimit }, nonce, gasPrice] = await Promise.all([
      this.prepareTxData(asset, fromAddress, toAddress, amountWei),
      this.getTransactionCount(fromAddress),
      this.getRecommendedGasPrice(),
    ]);

    return {
      chainId: this.chainId,
      from: fromAddress,
      to,
      data,
      value,
      nonce,
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
    };
  }

  private async prepareTxData(
    asset: Asset,
    fromAddress: string,
    toAddress: string,
    amountWei: EthersNumber,
  ): Promise<{ to: string; data: string; value: string; gasLimit: EthersNumber }> {
    if (asset.type === AssetType.COIN) {
      return {
        to: toAddress,
        data: '0x',
        value: amountWei.toString(),
        gasLimit: await this.getCurrentGasForCoinTransaction(
          fromAddress,
          toAddress,
          +EvmUtil.fromWeiAmount(amountWei, asset.decimals),
        ),
      };
    } else {
      const contract = this.getERC20ContractForDex(asset.chainId);
      return {
        to: asset.chainId,
        data: EvmUtil.encodeErc20Transfer(toAddress, amountWei),
        value: '0',
        gasLimit: await this.getTokenGasLimitForContact(contract, toAddress, amountWei),
      };
    }
  }

  // --- PUBLIC API - WRITE TRANSACTIONS --- //

  async sendRawTransactionFromAccount(
    account: WalletAccount,
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    return this.sendRawTransaction(wallet, request);
  }

  async sendRawTransactionFromDex(
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    return this.sendRawTransaction(this.wallet, request);
  }

  async sendRawTransactionFrom(
    privateKey: string,
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    const wallet = new ethers.Wallet(privateKey, this.provider);

    return this.sendRawTransaction(wallet, request);
  }

  async sendRawTransaction(
    wallet: ethers.Wallet,
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    let { gasPrice, value } = request;

    const currentNonce = await this.getNonce(request.from);
    const txNonce = request.nonce ? +request.nonce.toString() : currentNonce;

    gasPrice = gasPrice ?? +(await this.getRecommendedGasPrice());
    value = EvmUtil.toWeiAmount(value as number);

    const result = await wallet.sendTransaction({
      ...request,
      nonce: txNonce,
      gasPrice,
      value,
    });

    if (txNonce >= currentNonce) this.setNonce(request.from, txNonce + 1);

    return result;
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number): Promise<string> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    return this.sendNativeCoin(wallet, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number, nonce?: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount, nonce);
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number): Promise<string> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    const contract = new ethers.Contract(token.chainId, ERC20_ABI, wallet);

    return this.sendToken(contract, wallet.address, toAddress, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number, nonce?: number): Promise<string> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.sendToken(contract, this.walletAddress, toAddress, amount, nonce);
  }

  async isPermitContract(address: string): Promise<boolean> {
    return this.contractHasMethod(address, SIGNATURE_TRANSFER_ABI, 'permitTransferFrom');
  }

  async permitTransfer(
    from: string,
    signature: string,
    signatureTransferContract: string,
    asset: Asset,
    amount: number,
    permittedAmount: number,
    to: string,
    nonce: number,
    deadline: BigNumberish,
  ): Promise<string> {
    const contract = new ethers.Contract(signatureTransferContract, SIGNATURE_TRANSFER_ABI, this.wallet);

    const requestedAmount = EvmUtil.toWeiAmount(amount, asset.decimals);
    const permittedAmountWei = EvmUtil.toWeiAmount(permittedAmount, asset.decimals);

    const values = {
      permitted: {
        token: asset.chainId,
        amount: permittedAmountWei,
      },
      spender: this.walletAddress,
      nonce,
      deadline,
    };
    const transferDetails = { to, requestedAmount };

    const gasPrice = +(await this.getRecommendedGasPrice());
    const currentNonce = await this.getNonce(this.walletAddress);

    const result = await contract.permitTransferFrom(values, transferDetails, from, signature, {
      gasPrice,
      nonce: currentNonce,
    });

    this.setNonce(this.walletAddress, currentNonce + 1);

    return result.hash;
  }

  async sendSignedTransaction(tx: string): Promise<EvmSignedTransactionResponse> {
    const txToUse = tx.toLowerCase().startsWith('0x') ? tx : '0x' + tx;

    return this.alchemyService
      .sendTransaction(this.chainId, txToUse)
      .then((r) => ({
        response: r,
      }))
      .catch((e) => ({
        error: {
          code: e.code,
          message: e.message,
        },
      }));
  }

  // --- PUBLIC API - UTILITY --- //

  async isTxComplete(txHash: string, confirmations = 0): Promise<boolean> {
    const transaction = await this.getTxReceipt(txHash);

    if (transaction?.confirmations > confirmations) {
      if (transaction.status) return true;

      throw new Error(`Transaction ${txHash} has failed`);
    }

    return false;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.provider.getTransaction(txHash);
  }

  async getTxReceipt(txHash: string): Promise<ethers.providers.TransactionReceipt> {
    return this.provider.getTransactionReceipt(txHash);
  }

  async isContract(address: string): Promise<boolean> {
    const code = await this.provider.getCode(address);
    return code !== '0x';
  }

  async verifyErc1271Signature(message: string, address: string, signature: string): Promise<boolean> {
    const ERC1271_MAGIC_VALUE = '0x1626ba7e';

    const hash = hashMessage(message);
    const contract = new Contract(address, ERC1271_ABI, this.provider);
    const result = await contract.isValidSignature(hash, signature);
    return result === ERC1271_MAGIC_VALUE;
  }

  // got from https://gist.github.com/gluk64/fdea559472d957f1138ed93bcbc6f78a
  async getTxError(txHash: string): Promise<string> {
    const tx = await this.getTx(txHash);
    if (!tx) throw new Error('Transaction not found');

    delete tx.maxFeePerGas;
    delete tx.maxPriorityFeePerGas;

    return this.provider.call(tx, tx.blockNumber);
  }

  async getTxNonce(txHash: string): Promise<number> {
    return this.provider.getTransaction(txHash).then((r) => r?.nonce);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice } = await this.getTxReceipt(txHash);
    const actualFee = gasUsed.mul(effectiveGasPrice);

    return EvmUtil.fromWeiAmount(actualFee);
  }

  async getGasPriceLimitFromHex(txHex: string): Promise<number> {
    const currentGasPrice = await this.getRecommendedGasPrice();
    return EvmUtil.getGasPriceLimitFromHex(txHex, currentGasPrice);
  }

  async approveContract(asset: Asset, contractAddress: string): Promise<string> {
    const contract = this.getERC20ContractForDex(asset.chainId);

    const transaction = await contract.populateTransaction.approve(contractAddress, ethers.constants.MaxInt256);

    const gasPrice = await this.getRecommendedGasPrice();
    const nonce = await this.getNonce(this.walletAddress);

    const tx = await this.wallet.sendTransaction({
      ...transaction,
      from: this.walletAddress,
      gasPrice,
      nonce,
    });

    this.setNonce(this.walletAddress, nonce + 1);

    return tx.hash;
  }

  // --- PUBLIC API - SWAPS --- //

  async getUniswapLiquidity(nftContract: string, positionId: number): Promise<[number, number]> {
    const position = await this.getUniswapPosition(nftContract, positionId);

    // extract pool infos
    const [token0, token1] = await Promise.all([
      this.getTokenByAddress(position.token0),
      this.getTokenByAddress(position.token1),
    ]);
    const pool = this.getPoolContract(
      Pool.getAddress(token1, token0, position.fee, undefined, this.swapFactoryAddress),
    );
    const slot0 = await pool.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;

    // calculate amount
    const [amount0, amount1] = this.getUniswapPositionAmounts(position, sqrtPriceX96);
    return [
      EvmUtil.fromWeiAmount(BigInt(Math.round(amount0)).toString(), token0.decimals),
      EvmUtil.fromWeiAmount(BigInt(Math.round(amount1)).toString(), token1.decimals),
    ];
  }

  private getUniswapPositionAmounts(position: UniswapPosition, sqrtPriceX96: any): [number, number] {
    const sqrtRatioA = Math.sqrt(1.0001 ** position.tickLower);
    const sqrtRatioB = Math.sqrt(1.0001 ** position.tickUpper);
    const currentTick = Math.log((sqrtPriceX96 / 2 ** 96) ** 2) / Math.log(1.0001);
    const sqrtPrice = sqrtPriceX96 / 2 ** 96;

    if (currentTick <= position.tickLower) {
      return [+position.liquidity * ((sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB)), 0];
    } else if (currentTick > position.tickUpper) {
      return [0, +position.liquidity * (sqrtRatioB - sqrtRatioA)];
    } else if (currentTick >= position.tickLower && currentTick < position.tickUpper) {
      return [
        +position.liquidity * ((sqrtRatioB - sqrtPrice) / (sqrtPrice * sqrtRatioB)),
        +position.liquidity * (sqrtPrice - sqrtRatioA),
      ];
    }
  }

  private async getUniswapPosition(positionsNft: string, positionId: number): Promise<UniswapPosition> {
    const contract = new ethers.Contract(positionsNft, UNISWAP_V3_NFT_MANAGER_ABI, this.wallet);
    return contract.positions(positionId);
  }

  async getPoolAddress(asset1: Asset, asset2: Asset, poolFee: FeeAmount): Promise<string> {
    const [token1, token2] = await this.getTokenPair(asset1, asset2);

    return Pool.getAddress(token1, token2, poolFee, undefined, this.swapFactoryAddress);
  }

  async testSwap(
    source: Asset,
    sourceAmount: number,
    target: Asset,
    maxSlippage: number,
  ): Promise<{ targetAmount: number; feeAmount: number }> {
    if (source.id === target.id) return { targetAmount: sourceAmount, feeAmount: 0 };

    const route = await this.getRoute(source, target, sourceAmount, maxSlippage);

    return {
      targetAmount: +route.quote.toExact(),
      feeAmount: EvmUtil.fromWeiAmount(route.estimatedGasUsed.mul(route.gasPriceWei)),
    };
  }

  async testSwapPool(
    source: Asset,
    sourceAmount: number,
    target: Asset,
    poolFee: FeeAmount,
  ): Promise<{ targetAmount: number; feeAmount: number; priceImpact: number }> {
    if (source.id === target.id) return { targetAmount: sourceAmount, feeAmount: 0, priceImpact: 0 };

    const [sourceToken, targetToken] = await this.getTokenPair(source, target);

    const poolContract = this.getPoolContract(
      Pool.getAddress(sourceToken, targetToken, poolFee, undefined, this.swapFactoryAddress),
    );

    const token0IsInToken = sourceToken.address === (await poolContract.token0());
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;

    const quote = await this.poolQuote(sourceToken, targetToken, sourceAmount, poolFee);

    let sqrtPriceRatio = +quote.sqrtPriceX96 / +sqrtPriceX96;
    if (!token0IsInToken) sqrtPriceRatio = 1 / sqrtPriceRatio;

    const gasPrice = await this.getRecommendedGasPrice();

    return {
      targetAmount: EvmUtil.fromWeiAmount(quote.amountOut, targetToken.decimals),
      feeAmount: EvmUtil.fromWeiAmount(quote.gasEstimate.mul(gasPrice)),
      priceImpact: Math.abs(1 - sqrtPriceRatio),
    };
  }

  async swap(sourceToken: Asset, sourceAmount: number, targetToken: Asset, maxSlippage: number): Promise<string> {
    const route = await this.getRoute(sourceToken, targetToken, sourceAmount, maxSlippage);

    return this.doSwap(route.methodParameters);
  }

  async swapPool(
    source: Asset,
    target: Asset,
    sourceAmount: number,
    poolFee: FeeAmount,
    maxSlippage: number,
  ): Promise<string> {
    // get pool info
    const [sourceToken, targetToken] = await this.getTokenPair(source, target);

    const { amountOut, route } = await this.poolQuote(sourceToken, targetToken, sourceAmount, poolFee);

    // generate call parameters
    const trade = Trade.createUncheckedTrade({
      route,
      inputAmount: this.toCurrencyAmount(sourceAmount, sourceToken),
      outputAmount: CurrencyAmount.fromRawAmount(targetToken, +amountOut),
      tradeType: TradeType.EXACT_INPUT,
    });

    const parameters = buildSwapMethodParameters(trade as any, this.swapConfig(maxSlippage), this.chainId);

    return this.doSwap(parameters);
  }

  private async poolQuote(
    sourceToken: Token,
    targetToken: Token,
    sourceAmount: number,
    poolFee: FeeAmount,
  ): Promise<{
    amountOut: EthersNumber;
    sqrtPriceX96: EthersNumber;
    gasEstimate: EthersNumber;
    route: Route<Token, Token>;
  }> {
    const poolContract = this.getPoolContract(
      Pool.getAddress(sourceToken, targetToken, poolFee, undefined, this.swapFactoryAddress),
    );
    const [liquidity, slot0] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);

    // create route
    const pool = new Pool(sourceToken, targetToken, poolFee, slot0[0].toString(), liquidity.toString(), slot0[1]);
    const route = new Route([pool], sourceToken, targetToken);

    const { calldata } = SwapQuoter.quoteCallParameters(
      route,
      this.toCurrencyAmount(sourceAmount, sourceToken),
      TradeType.EXACT_INPUT,
      {
        useQuoterV2: true,
      },
    );
    const quoteCallReturnData = await this.provider.call({
      to: this.quoteContractAddress,
      data: calldata,
    });

    const [amountOut, sqrtPriceX96, _, gasEstimate] = ethers.utils.defaultAbiCoder.decode(
      QuoterV2ABI.abi.find((f) => f.name === 'quoteExactInputSingle')?.outputs.map((o) => o.type),
      quoteCallReturnData,
    );

    return { amountOut, sqrtPriceX96, gasEstimate, route };
  }

  async getSwapResult(txId: string, asset: Asset): Promise<number> {
    const receipt = await this.getTxReceipt(txId);

    const swapLog = receipt?.logs?.find((l) => l.address.toLowerCase() === asset.chainId);
    if (!swapLog) throw new Error(`Failed to get swap result for TX ${txId}`);

    const token = await this.getToken(asset);
    return EvmUtil.fromWeiAmount(swapLog.data, token.decimals);
  }

  private async getRoute(source: Asset, target: Asset, sourceAmount: number, maxSlippage: number): Promise<SwapRoute> {
    if (!this.router) throw new Error(`No router initialized for chain ${this.chainId}`);

    const sourceToken = await this.getToken(source);
    const targetToken = await this.getToken(target);

    const route = await this.router.route(
      this.toCurrencyAmount(sourceAmount, sourceToken),
      targetToken,
      TradeType.EXACT_INPUT,
      this.swapConfig(maxSlippage),
    );

    if (!route)
      throw new Error(
        `No swap route found for ${sourceAmount} ${source.name} -> ${target.name} (${source.blockchain})`,
      );

    return route;
  }

  private async doSwap(parameters: MethodParameters) {
    const gasPrice = await this.getRecommendedGasPrice();
    const nonce = await this.getNonce(this.walletAddress);

    const tx = await this.wallet.sendTransaction({
      data: parameters.calldata,
      to: this.swapContractAddress,
      value: parameters.value,
      from: this.walletAddress,
      gasPrice,
      nonce,
    });

    this.setNonce(this.walletAddress, nonce + 1);

    return tx.hash;
  }

  async sqrtX96Price(price: number, source: Asset, target: Asset, poolFee: FeeAmount): Promise<number> {
    const [sourceToken, targetToken] = await this.getTokenPair(source, target);

    const poolContract = this.getPoolContract(
      Pool.getAddress(sourceToken, targetToken, poolFee, undefined, this.swapFactoryAddress),
    );
    const token0IsInToken = sourceToken.address === (await poolContract.token0());
    const [token0, token1] = token0IsInToken ? [sourceToken, targetToken] : [targetToken, sourceToken];

    price = token0IsInToken ? 1 / price : price;

    return Math.sqrt((price * 10 ** token1.decimals) / 10 ** token0.decimals) * 2 ** 96;
  }

  // --- GETTERS --- //
  get walletAddress(): string {
    return this.wallet.address;
  }

  swapConfig(maxSlippage: number): SwapOptions {
    const config: SwapOptions = {
      recipient: this.walletAddress,
      slippageTolerance: new Percent(maxSlippage * 10000000, 10000000),
      deadline: Math.floor(Util.minutesAfter(30).getTime() / 1000),
      type: SwapType.SWAP_ROUTER_02,
    };

    return config;
  }

  // --- PUBLIC HELPER METHODS --- //

  async getToken(asset: Asset): Promise<Currency> {
    return asset.type === AssetType.COIN ? Ether.onChain(this.chainId) : this.getTokenByAddress(asset.chainId);
  }

  async getTokenPair(asset1: Asset, asset2: Asset): Promise<[Token, Token]> {
    const token1 = await this.getToken(asset1);
    const token2 = await this.getToken(asset2);

    if (token1 instanceof NativeCurrency || token2 instanceof NativeCurrency)
      throw new Error(`Only tokens can be in a pool`);

    return [token1, token2];
  }

  getPoolContract(poolAddress: string): Contract {
    return new ethers.Contract(poolAddress, IUniswapV3PoolABI.abi, this.wallet);
  }

  getQuoteContract(): Contract {
    return new ethers.Contract(this.quoteContractAddress, QuoterV2ABI.abi, this.wallet);
  }

  // --- PRIVATE HELPER METHODS --- //

  private toCurrencyAmount<T extends NativeCurrency | Token>(amount: number, token: T): CurrencyAmount<T> {
    const targetAmount = EvmUtil.toWeiAmount(amount, token.decimals).toString();

    return CurrencyAmount.fromRawAmount(token, targetAmount);
  }

  private async getTokenByAddress(address: string): Promise<Token> {
    const contract = this.getERC20ContractForDex(address);
    return this.getTokenByContract(contract);
  }

  protected getERC20ContractForDex(tokenAddress: string): Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
  }

  protected async getTokenByContract(contract: Contract): Promise<Token> {
    return this.tokens.get(
      contract.address,
      async () => new Token(this.chainId, contract.address, await contract.decimals()),
    );
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGas = await this.getCurrentGasForCoinTransaction(this.walletAddress, this.randomReceiverAddress, 1e-18);
    const gasPrice = await this.getRecommendedGasPrice();

    return EvmUtil.fromWeiAmount(totalGas.mul(gasPrice));
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGas = await this.getTokenGasLimitForAsset(token);
    const gasPrice = await this.getRecommendedGasPrice();

    return EvmUtil.fromWeiAmount(totalGas.mul(gasPrice));
  }

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    toAddress: string,
    amount: number,
    nonce?: number,
  ): Promise<string> {
    const fromAddress = wallet.address;

    const gasLimit = await this.getCurrentGasForCoinTransaction(fromAddress, toAddress, amount);
    const gasPrice = +(await this.getRecommendedGasPrice());
    const currentNonce = await this.getNonce(fromAddress);
    const txNonce = nonce ?? currentNonce;

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: EvmUtil.toWeiAmount(amount),
      nonce: txNonce,
      gasPrice,
      gasLimit,
    });

    if (txNonce >= currentNonce) this.setNonce(fromAddress, txNonce + 1);

    return tx.hash;
  }

  protected async getCurrentGasForCoinTransaction(from: string, to: string, amount: number): Promise<EthersNumber> {
    return this.provider.estimateGas({
      from,
      to,
      value: EvmUtil.toWeiAmount(amount),
    });
  }

  private async sendToken(
    contract: Contract,
    fromAddress: string,
    toAddress: string,
    amount: number,
    nonce?: number,
  ): Promise<string> {
    const gasLimit = +(await this.getTokenGasLimitForContact(contract, toAddress));
    const gasPrice = +(await this.getRecommendedGasPrice());
    const currentNonce = await this.getNonce(fromAddress);
    const txNonce = nonce ?? currentNonce;

    const token = await this.getTokenByContract(contract);
    const targetAmount = EvmUtil.toWeiAmount(amount, token.decimals);

    const tx = await contract.transfer(toAddress, targetAmount, { gasPrice, gasLimit, nonce: txNonce });

    if (txNonce >= currentNonce) this.setNonce(fromAddress, txNonce + 1);

    return tx.hash;
  }

  protected async getNonce(address: string): Promise<number> {
    const nonceEntry = this.nonce.get(address);
    const cachedNonce = (nonceEntry?.date > Util.minutesBefore(10) && nonceEntry.value) || 0;
    const blockchainNonce = await this.provider.getTransactionCount(address);

    return Math.max(blockchainNonce, cachedNonce);
  }

  protected setNonce(address: string, nonce: number): void {
    this.nonce.set(address, { value: nonce, date: new Date() });
  }

  private async getHistory<T>(
    direction: Direction,
    walletAddress: string,
    categories: AssetTransfersCategory[],
    fromBlock: number,
    toBlock?: number,
  ): Promise<T[]> {
    const params: AssetTransfersParams = {
      fromBlock: fromBlock,
      toBlock: toBlock,
      categories: categories,
    };

    const assetTransferResult: AssetTransfersWithMetadataResult[] = [];

    if ([Direction.OUTGOING, Direction.BOTH].includes(direction)) {
      params.fromAddress = walletAddress;
      params.toAddress = undefined;

      assetTransferResult.push(...(await this.alchemyService.getAssetTransfers(this.chainId, params)));
    }

    if ([Direction.INCOMING, Direction.BOTH].includes(direction)) {
      params.fromAddress = undefined;
      params.toAddress = walletAddress;

      assetTransferResult.push(...(await this.alchemyService.getAssetTransfers(this.chainId, params)));
    }

    assetTransferResult.sort((atr1, atr2) => Number(atr1.blockNum) - Number(atr2.blockNum));

    return <T[]>assetTransferResult.map((atr) => ({
      blockNumber: Number(atr.blockNum).toString(),
      timeStamp: Number(new Date(atr.metadata.blockTimestamp).getTime() / 1000).toString(),
      hash: atr.hash,
      from: atr.from,
      to: atr.to,
      value: new BigNumber(atr.rawContract.value).toString(),
      contractAddress: atr.rawContract.address ?? '',
      tokenName: atr.asset,
      tokenDecimal: Number(atr.rawContract.decimal).toString(),
    }));
  }

  private async contractHasMethod(address: string, abi: any, method: string): Promise<boolean> {
    const method_selector = new ethers.utils.Interface(abi).getSighash(method).substring(2);

    return this.provider.getCode(address).then((code) => code.includes(method_selector));
  }
}
