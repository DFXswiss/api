import { Injectable } from '@nestjs/common';
import { NativeCurrency } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
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
    private readonly assetService: AssetService,
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
      tradingRule.source2 === PriceSource.DEX ? `${tradingRule.poolFee}` : undefined,
    );
    if (tradingRule.source2 === PriceSource.DEX)
      price2.price = price2.price / (1 + EvmUtil.poolFeeFactor(tradingRule.poolFee));

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

    const usePriceImpact = Math.abs(tradingInfo.priceImpact) / 2;
    const checkPriceImpact = usePriceImpact.toFixed(6);
    const estimatedProfitPercent = usePriceImpact - EvmUtil.poolFeeFactor(tradingInfo.poolFee);

    const coin = await this.assetService.getNativeAsset(tradingInfo.assetIn.blockchain);

    const poolBalance = await client.getTokenBalance(tradingInfo.assetOut, poolContract.address);
    const poolBalanceLimit = 0.99; // cannot swap 100% of the pool balance, therefore reduce by 1%
    const checkPoolBalance = poolBalance * poolBalanceLimit;

    let amountIn = START_AMOUNT_IN * tradingInfo.assetIn.minimalPriceReferenceAmount;

    let { targetAmount, feeAmount, priceImpact } = await client.testSwapPool(
      tradingInfo.assetIn,
      amountIn,
      tradingInfo.assetOut,
      tradingInfo.poolFee,
    );

    if (checkPoolBalance <= targetAmount)
      throw new PoolOutOfRangeException(
        `Pool balance ${checkPoolBalance} is lower than required output amount ${targetAmount}`,
      );

    const maxAllowedLoopCounter = 100;
    let currentLoopCounter = 0;

    while (checkPriceImpact !== priceImpact.toFixed(6)) {
      const ratio = usePriceImpact / priceImpact;
      amountIn *= ratio;

      ({ targetAmount, feeAmount, priceImpact } = await client.testSwapPool(
        tradingInfo.assetIn,
        amountIn,
        tradingInfo.assetOut,
        tradingInfo.poolFee,
      ));

      if (checkPoolBalance <= targetAmount)
        throw new PoolOutOfRangeException(
          `Pool balance ${checkPoolBalance} is lower than required output amount ${targetAmount}`,
        );

      if (++currentLoopCounter > maxAllowedLoopCounter)
        throw new Error(
          `Max allowed loop counter exceeded: checkPriceImpact ${checkPriceImpact}, calcPriceImpact ${priceImpact.toFixed(
            6,
          )}`,
        );
    }

    const estimatedProfitChf = Util.round(amountIn * tradingInfo.assetIn.approxPriceChf * estimatedProfitPercent, 2);
    const swapFeeChf = Util.round(feeAmount * coin.approxPriceChf, 2);
    if (swapFeeChf > estimatedProfitChf)
      throw new Error(`Swap fee (${swapFeeChf} CHF) ist larger than estimated profit (${estimatedProfitChf} CHF)`);

    tradingInfo.amountIn = amountIn;
    tradingInfo.amountOut = targetAmount;

    return tradingInfo;
  }

  private async getPoolContract(client: EvmClient, tradingInfo: TradingInfo): Promise<ethers.Contract> {
    const poolAddress = await client.getPoolAddress(tradingInfo.assetIn, tradingInfo.assetOut, tradingInfo.poolFee);
    return client.getPoolContract(poolAddress);
  }
}
