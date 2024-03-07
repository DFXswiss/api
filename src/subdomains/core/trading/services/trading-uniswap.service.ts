import { Inject } from '@nestjs/common';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import QuoterV2ABI from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { UniswapPoolBalanceDto, UniswapPoolTradingInfoDto } from '../dto/uniswap.dto';
import { TradingRule } from '../entities/trading-rule.entity';

// https://docs.uniswap.org/contracts/v3/reference/deployments
//const POOL_FACTORY_CONTRACT_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const QUOTER_V2_CONTRACT_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const START_AMOUNT_IN = 10000;

// Uniswap Pool:
// Ethereum: 0x8e4318e2cb1ae291254b187001a59a1f8ac78cef
// Polygon:  0xde04b24bd3e3abbbd119b8eea219f72c8d6d4c60

// USDT:
// Ethereum: 0xdac17f958d2ee523a2206206994597c13d831ec7
// Polygon:  0xc2132D05D31c914a87C6611C10748AEb04B58e8F

// ZCHF:
// Ethereum: 0xb58e61c3098d85632df34eecfb899a1ed80921cb
// Polygon:  0x02567e4b14b25549331fCEe2B56c647A8bAB16FD

export abstract class TradingUniswapService {
  private provider: ethers.providers.JsonRpcProvider;

  @Inject()
  private readonly pricingService: PricingService;

  abstract blockchain: Blockchain;

  constructor(gatewayUrl: string, apiKey: string, chainId: number, private poolAddress: string) {
    const url = `${gatewayUrl}/${apiKey ?? ''}`;
    this.provider = new ethers.providers.JsonRpcProvider(url, chainId);
  }

  async createTradingInfo(tradingRule: TradingRule): Promise<UniswapPoolTradingInfoDto> {
    const tradingInfo = await this.getPriceImpactForTrading(tradingRule);
    const priceImpact = tradingInfo.swap.priceImpact;

    if (priceImpact >= tradingRule.upperLimit) {
      const amount = await this.calculateAmountToken0ToToken1(priceImpact);

      tradingInfo.swap.assetIn = tradingRule.leftAsset;
      tradingInfo.swap.assetOut = tradingRule.rightAsset;
      tradingInfo.swap.amountIn = amount;

      console.log(`Amount from ZCHF to USDT: ${amount}`);
    } else if (priceImpact <= -tradingRule.lowerLimit) {
      const amount = await this.calculateAmountToken1ToToken0(priceImpact);

      tradingInfo.swap.assetIn = tradingRule.rightAsset;
      tradingInfo.swap.assetOut = tradingRule.leftAsset;
      tradingInfo.swap.amountIn = amount;

      console.log(`Amount from USDT to ZCHF: ${amount}`);
    }

    return tradingInfo;
  }

  private async getPriceImpactForTrading(tradingRule: TradingRule): Promise<UniswapPoolTradingInfoDto> {
    const price1 = await this.pricingService.getPriceFrom(
      tradingRule.source1,
      tradingRule.leftAsset1,
      tradingRule.rightAsset1,
    );

    const price2 = await this.pricingService.getPriceFrom(
      tradingRule.source2,
      tradingRule.leftAsset2,
      tradingRule.rightAsset2,
    );

    console.log(JSON.stringify(price1));
    console.log(JSON.stringify(price2));

    const tradingInfo: UniswapPoolTradingInfoDto = {
      source1: {
        name: tradingRule.source1,
        leftAsset: tradingRule.leftAsset1,
        rightAsset: tradingRule.rightAsset1,
        price: price1.price,
      },
      source2: {
        name: tradingRule.source2,
        leftAsset: tradingRule.leftAsset2,
        rightAsset: tradingRule.rightAsset2,
        price: price2.price,
      },
      swap: {
        priceImpact: 0,
      },
    };

    if (price1.isValid && price2.isValid) {
      const ratio = price1.price / price2.price;
      const priceImpact = (ratio - 1) * 100;
      tradingInfo.swap.priceImpact = priceImpact;
      console.log(`ratio:       ${ratio}`);
      console.log(`priceImpact: ${priceImpact}`);
    }

    console.log('--------------------------------------------------------------------------------');

    return tradingInfo;
  }

  private async calculateAmountToken0ToToken1(priceImpact: number): Promise<number> {
    const poolContract = new ethers.Contract(this.poolAddress, IUniswapV3PoolABI.abi, this.provider);
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();

    return this.calculateAmountForPriceImpact(poolContract, token0, token1, priceImpact, true);
  }

  private async calculateAmountToken1ToToken0(priceImpact: number): Promise<number> {
    const poolContract = new ethers.Contract(this.poolAddress, IUniswapV3PoolABI.abi, this.provider);
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();

    return this.calculateAmountForPriceImpact(poolContract, token1, token0, priceImpact, false);
  }

  private async calculateAmountForPriceImpact(
    poolContract: ethers.Contract,
    tokenInAddress: string,
    tokenOutAddress: string,
    priceImpact: number,
    token0IsInToken: boolean,
  ): Promise<number> {
    const usePriceImpact = Math.abs(priceImpact) / 2;
    const checkPriceImpact = usePriceImpact.toFixed(3);

    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;
    const fee = await poolContract.fee();

    const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, this.provider);
    const tokenInDecimals = await tokenInContract.decimals();

    const quoterV2Contract = new ethers.Contract(QUOTER_V2_CONTRACT_ADDRESS, QuoterV2ABI.abi, this.provider);

    const poolBalance = await this.getPoolBalanceByContract(poolContract);
    const poolBalanceLimit = 0.99; // cannot swap 100% of the pool balance, therefore reduce by 1%
    const checkPoolBalance =
      (token0IsInToken ? poolBalance.token1.balance : poolBalance.token0.balance) * poolBalanceLimit;

    let amountIn = START_AMOUNT_IN;
    if (checkPoolBalance <= amountIn)
      throw new Error(`Pool balance ${checkPoolBalance} is lower than start amount ${amountIn}`);

    const quoterV2Params = {
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      fee: fee,
      amountIn: EvmUtil.toWeiAmount(amountIn, tokenInDecimals),
      sqrtPriceLimitX96: '0',
    };

    let calcPriceImpact = await this.calculatePriceImpact(
      quoterV2Contract,
      quoterV2Params,
      token0IsInToken,
      sqrtPriceX96,
    );

    console.log(`amount:      ${amountIn}`);
    console.log(`priceImpact: ${calcPriceImpact.toFixed(3)}%`);

    const maxAllowedLoopCounter = 10;
    let currentLoopCounter = 0;

    while (checkPriceImpact !== calcPriceImpact.toFixed(3)) {
      const ratio = usePriceImpact / calcPriceImpact;
      amountIn *= ratio;

      if (checkPoolBalance <= amountIn)
        throw new Error(`Pool balance ${checkPoolBalance} is lower than calculated amount ${amountIn}`);

      quoterV2Params.amountIn = EvmUtil.toWeiAmount(amountIn, tokenInDecimals);
      calcPriceImpact = await this.calculatePriceImpact(
        quoterV2Contract,
        quoterV2Params,
        token0IsInToken,
        sqrtPriceX96,
      );

      console.log(`ratio:       ${ratio}`);
      console.log(`amount:      ${amountIn}`);
      console.log(`priceImpact: ${calcPriceImpact.toFixed(3)}%`);

      if (++currentLoopCounter > maxAllowedLoopCounter)
        throw new Error(
          `Max allowed loop counter exceeded: checkPriceImpact ${checkPriceImpact}%, calcPriceImpact ${calcPriceImpact.toFixed(
            3,
          )}%`,
        );
    }

    console.log('--------------------------------------------------------------------------------');

    return amountIn;
  }

  private async calculatePriceImpact(
    quoterV2Contract: ethers.Contract,
    quoterV2Params: any,
    token0IsInToken: boolean,
    sqrtPriceX96: number,
  ): Promise<number> {
    const quote = await quoterV2Contract.callStatic.quoteExactInputSingle(quoterV2Params);
    const sqrtPriceX96After = quote.sqrtPriceX96After;

    let sqrtPriceRatio = sqrtPriceX96After / sqrtPriceX96;
    if (!token0IsInToken) sqrtPriceRatio = 1 / sqrtPriceRatio;

    return (Math.abs(1 - sqrtPriceRatio) + 0.0001) * 100;
  }

  async getPoolBalance(): Promise<UniswapPoolBalanceDto> {
    const poolContract = new ethers.Contract(this.poolAddress, IUniswapV3PoolABI.abi, this.provider);
    return this.getPoolBalanceByContract(poolContract);
  }

  private async getPoolBalanceByContract(poolContract: ethers.Contract): Promise<UniswapPoolBalanceDto> {
    const token0Address = await poolContract.token0();
    const token1Address = await poolContract.token1();

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, this.provider);
    const token0Name = await token0Contract.name();
    const token0Symbol = await token0Contract.symbol();
    const token0Decimals = await token0Contract.decimals();

    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, this.provider);
    const token1Name = await token1Contract.name();
    const token1Symbol = await token1Contract.symbol();
    const token1Decimals = await token1Contract.decimals();

    const token0PoolBalance = await token0Contract.balanceOf(poolContract.address);
    const token1PoolBalance = await token1Contract.balanceOf(poolContract.address);

    return {
      token0: {
        address: token0Address,
        name: token0Name,
        symbol: token0Symbol,
        decimals: token0Decimals,
        balance: EvmUtil.fromWeiAmount(token0PoolBalance, token0Decimals),
      },
      token1: {
        address: token1Address,
        name: token1Name,
        symbol: token1Symbol,
        decimals: token1Decimals,
        balance: EvmUtil.fromWeiAmount(token1PoolBalance, token1Decimals),
      },
    };
  }
}
