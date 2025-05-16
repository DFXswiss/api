import { Injectable } from '@nestjs/common';
import { NativeCurrency } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { TradingInfo } from '../dto/trading.dto';
import { PriceConfig, TradingRule } from '../entities/trading-rule.entity';
import { PoolOutOfRangeException } from '../exceptions/pool-out-of-range.exception';

@Injectable()
export class TradingService {
  private readonly logger = new DfxLogger(TradingService);

  constructor(
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
  ) {}

  async createTradingInfo(tradingRule: TradingRule): Promise<TradingInfo> {
    if (tradingRule.leftAsset.blockchain !== tradingRule.rightAsset.blockchain)
      throw new Error(`Blockchain mismatch in trading rule ${tradingRule.id}`);

    let tradingInfo = await this.getTradingInfo(tradingRule);
    if (tradingInfo.tradeRequired) tradingInfo = await this.calculateAmountForPriceImpact(tradingRule, tradingInfo);

    return tradingInfo;
  }

  private async getTradingInfo(tradingRule: TradingRule): Promise<TradingInfo> {
    // get prices
    const referencePrice = await this.getPrice(tradingRule.config1);
    const checkPrice = await this.getPrice(tradingRule.config3 ?? tradingRule.config1);
    const poolPrice = await this.getPrice(tradingRule.config2);

    const lowerTargetPrice = referencePrice.price * tradingRule.lowerTarget;
    const upperTargetPrice = referencePrice.price * tradingRule.upperTarget;

    const lowerCheckPrice = checkPrice.price * tradingRule.lowerTarget;
    const upperCheckPrice = checkPrice.price * tradingRule.upperTarget;

    const currentPrice =
      tradingRule.config2.source === PriceSource.DEX
        ? poolPrice.price / (1 + EvmUtil.poolFeeFactor(tradingRule.poolFee))
        : poolPrice.price;

    // calculate current deviation
    const lowerDeviation = currentPrice / lowerTargetPrice - 1;
    const upperDeviation = currentPrice / upperTargetPrice - 1;

    const lowerCheckDeviation = currentPrice / lowerCheckPrice - 1;
    const upperCheckDeviation = currentPrice / upperCheckPrice - 1;

    let priceDeviationTooHigh: boolean;
    let checkDeviationTooHigh: boolean;

    let priceImpact: number;
    let assetIn: Asset;
    let assetOut: Asset;

    if (lowerDeviation < 0) {
      priceDeviationTooHigh = lowerDeviation < -tradingRule.lowerLimit;
      checkDeviationTooHigh = lowerCheckDeviation < -tradingRule.lowerLimit;

      priceImpact = lowerDeviation;
      assetIn = tradingRule.leftAsset;
      assetOut = tradingRule.rightAsset;
    } else {
      priceDeviationTooHigh = upperDeviation > tradingRule.upperLimit;
      checkDeviationTooHigh = upperCheckDeviation > tradingRule.upperLimit;

      priceImpact = upperDeviation;
      assetIn = tradingRule.rightAsset;
      assetOut = tradingRule.leftAsset;
    }

    const tradeRequired = priceDeviationTooHigh && checkDeviationTooHigh;

    const result: TradingInfo = {
      price1: referencePrice.price,
      price2: currentPrice,
      price3: checkPrice.price,
      poolFee: tradingRule.poolFee,
      priceImpact,
      assetIn,
      assetOut,
      tradeRequired,
      message: tradeRequired ? undefined : `${!priceDeviationTooHigh ? 'price' : 'check'} deviation in range`,
    };

    return result;
  }

  private async calculateAmountForPriceImpact(
    tradingRule: TradingRule,
    tradingInfo: TradingInfo,
  ): Promise<TradingInfo> {
    const client = this.blockchainRegistryService.getEvmClient(tradingInfo.assetIn.blockchain);

    const tokenIn = await client.getToken(tradingInfo.assetIn);
    const tokenOut = await client.getToken(tradingInfo.assetOut);

    if (tokenIn instanceof NativeCurrency || tokenOut instanceof NativeCurrency)
      throw new Error('Only tokens can be in a pool');

    const poolContract = await this.getPoolContract(client, tradingInfo);

    const usePriceImpact = Math.abs(tradingInfo.priceImpact) / 2;
    const checkPriceImpact = usePriceImpact.toFixed(6);
    const estimatedProfitPercent = usePriceImpact - EvmUtil.poolFeeFactor(tradingInfo.poolFee);

    const coin = await this.assetService.getNativeAsset(tradingInfo.assetIn.blockchain);

    const [assetInBalance, assetOutBalance] = await client
      .getTokenBalances([tradingInfo.assetIn, tradingInfo.assetOut], poolContract.address)
      .then((r) => r.map((b) => b.balance ?? 0));
    const poolBalanceLimit = 0.99; // cannot swap 100% of the pool balance, therefore reduce by 1%
    const checkPoolBalance = assetOutBalance * poolBalanceLimit;

    let amountIn = usePriceImpact * assetInBalance;

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

    tradingInfo.amountIn = amountIn;
    tradingInfo.amountExpected = targetAmount;

    const estimatedProfitChf = Util.round(amountIn * tradingInfo.assetIn.approxPriceChf * estimatedProfitPercent, 2);
    const swapFeeChf = Util.round(feeAmount * coin.approxPriceChf, 2);
    if (swapFeeChf > estimatedProfitChf) {
      tradingInfo.tradeRequired = false;
      tradingInfo.message = `Swap fee (${swapFeeChf} CHF) is larger than estimated profit (${estimatedProfitChf} CHF)`;

      this.logger.info(`Trading rule ${tradingRule.id} ignored: ${tradingInfo.message}`);
    }

    const approximateAmountOut =
      tradingRule.leftAsset.id === tradingInfo.assetIn.id
        ? amountIn / tradingInfo.price1
        : amountIn * tradingInfo.price1;
    if (Math.abs(targetAmount / approximateAmountOut - 1) > 0.1) {
      tradingInfo.tradeRequired = false;
      tradingInfo.message = `Estimated output amount ${targetAmount} is out of range, approximate amount is ${approximateAmountOut}`;

      this.logger.error(`Trading rule ${tradingRule.id} ignored: ${tradingInfo.message}`);
    }

    return tradingInfo;
  }

  private async getPoolContract(client: EvmClient, tradingInfo: TradingInfo): Promise<ethers.Contract> {
    const poolAddress = await client.getPoolAddress(tradingInfo.assetIn, tradingInfo.assetOut, tradingInfo.poolFee);
    return client.getPoolContract(poolAddress);
  }

  private async getPrice(config: PriceConfig): Promise<Price> {
    return this.pricingService.getPriceFrom(config.source, config.from, config.to, config.param);
  }
}
