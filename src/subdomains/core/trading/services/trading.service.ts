import { Injectable } from '@nestjs/common';
import { NativeCurrency, Token } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { TradingInfo } from '../dto/trading.dto';
import { TradingRule } from '../entities/trading-rule.entity';
import { PoolOutOfRangeException } from '../exceptions/pool-out-of-range.exception';

const START_AMOUNT_IN = 10000; // CHF

@Injectable()
export class TradingService {
  constructor(
    private readonly evmRegistryService: EvmRegistryService,
    private readonly pricingService: PricingService,
  ) {}

  async createTradingInfo(tradingRule: TradingRule): Promise<TradingInfo> {
    if (tradingRule.leftAsset.blockchain !== tradingRule.rightAsset.blockchain)
      throw new Error(`Blockchain mismatch in trading rule ${tradingRule.id}`);

    let tradingInfo = await this.getPriceImpactForTrading(tradingRule);

    if (tradingInfo.priceImpact >= tradingRule.upperLimit) {
      tradingInfo.assetIn = tradingRule.leftAsset;
      tradingInfo.assetOut = tradingRule.rightAsset;

      tradingInfo = await this.calculateAmountForPriceImpact(tradingInfo);
    } else if (tradingInfo.priceImpact <= -tradingRule.lowerLimit) {
      tradingInfo.assetIn = tradingRule.rightAsset;
      tradingInfo.assetOut = tradingRule.leftAsset;

      tradingInfo = await this.calculateAmountForPriceImpact(tradingInfo);
    }

    return tradingInfo;
  }

  private async getPriceImpactForTrading(tradingRule: TradingRule): Promise<TradingInfo> {
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

    const tradingInfo: TradingInfo = {
      price1: price1.price,
      price2: price2.price,
      priceImpact: 0,
      poolFee: tradingRule.poolFee,
    };

    if (price1.isValid && price2.isValid) {
      const ratio = price1.price / price2.price;
      tradingInfo.priceImpact = ratio - 1;
    }

    return tradingInfo;
  }

  private async calculateAmountForPriceImpact(tradingInfo: TradingInfo): Promise<TradingInfo> {
    const client = this.evmRegistryService.getClient(tradingInfo.assetIn.blockchain);

    const tokenIn = await client.getToken(tradingInfo.assetIn);
    const tokenOut = await client.getToken(tradingInfo.assetOut);

    if (tokenIn instanceof NativeCurrency || tokenOut instanceof NativeCurrency)
      throw new Error('Only tokens can be in a pool');

    const poolContract = await this.getPoolContract(client, tradingInfo);

    const token0Address = await poolContract.token0();
    const token0IsInToken = tokenIn.address === token0Address;

    const priceImpact = tradingInfo.priceImpact;
    const usePriceImpact = Math.abs(priceImpact) / 2;
    const checkPriceImpact = usePriceImpact.toFixed(6);

    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;
    const fee = await poolContract.fee();

    const poolBalance = await client.getTokenBalance(tradingInfo.assetOut, poolContract.address);
    const poolBalanceLimit = 0.99; // cannot swap 100% of the pool balance, therefore reduce by 1%
    const checkPoolBalance = poolBalance * poolBalanceLimit;

    let amountIn = START_AMOUNT_IN * tradingInfo.assetIn.minimalPriceReferenceAmount;

    const quoterV2Contract = client.getQuoteContract();

    const quoterV2Params = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      amountIn: EvmUtil.toWeiAmount(amountIn, tokenIn.decimals),
      sqrtPriceLimitX96: '0',
    };

    let { calcPriceImpact, amountOut } = await this.calculatePriceImpact(
      quoterV2Contract,
      quoterV2Params,
      token0IsInToken,
      sqrtPriceX96,
      tokenOut,
    );

    if (checkPoolBalance <= amountOut)
      throw new PoolOutOfRangeException(
        `Pool balance ${checkPoolBalance} is lower than required output amount ${amountOut}`,
      );

    const maxAllowedLoopCounter = 10;
    let currentLoopCounter = 0;

    while (checkPriceImpact !== calcPriceImpact.toFixed(6)) {
      const ratio = usePriceImpact / calcPriceImpact;
      amountIn *= ratio;

      quoterV2Params.amountIn = EvmUtil.toWeiAmount(amountIn, tokenIn.decimals);

      ({ calcPriceImpact, amountOut } = await this.calculatePriceImpact(
        quoterV2Contract,
        quoterV2Params,
        token0IsInToken,
        sqrtPriceX96,
        tokenOut,
      ));

      if (checkPoolBalance <= amountOut)
        throw new PoolOutOfRangeException(
          `Pool balance ${checkPoolBalance} is lower than required output amount ${amountOut}`,
        );

      if (++currentLoopCounter > maxAllowedLoopCounter)
        throw new Error(
          `Max allowed loop counter exceeded: checkPriceImpact ${checkPriceImpact}, calcPriceImpact ${calcPriceImpact.toFixed(
            6,
          )}`,
        );
    }

    tradingInfo.amountIn = amountIn;
    tradingInfo.amountOut = amountOut;

    return tradingInfo;
  }

  private async calculatePriceImpact(
    quoterV2Contract: ethers.Contract,
    quoterV2Params: any,
    token0IsInToken: boolean,
    sqrtPriceX96: number,
    tokenOut: Token,
  ): Promise<{ calcPriceImpact: number; amountOut: number }> {
    const quote = await quoterV2Contract.callStatic.quoteExactInputSingle(quoterV2Params);
    const sqrtPriceX96After = quote.sqrtPriceX96After;

    let sqrtPriceRatio = sqrtPriceX96After / sqrtPriceX96;
    if (!token0IsInToken) sqrtPriceRatio = 1 / sqrtPriceRatio;

    return {
      calcPriceImpact: Math.abs(1 - sqrtPriceRatio) + 0.0001,
      amountOut: EvmUtil.fromWeiAmount(quote.amountOut, tokenOut.decimals),
    };
  }

  private async getPoolContract(client: EvmClient, tradingInfo: TradingInfo): Promise<ethers.Contract> {
    const poolAddress = await client.getPoolAddress(tradingInfo.assetIn, tradingInfo.assetOut, tradingInfo.poolFee);
    return client.getPoolContract(poolAddress);
  }
}
