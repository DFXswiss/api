import { Injectable } from '@nestjs/common';
import { NativeCurrency } from '@uniswap/sdk-core';
import { ethers } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { TradingInfo } from '../dto/trading.dto';
import { TradingRule } from '../entities/trading-rule.entity';
import { PoolOutOfRangeException } from '../exceptions/pool-out-of-range.exception';

const START_AMOUNT_IN = 10000; // CHF

@Injectable()
export class TradingService {
  private readonly logger = new DfxLogger(TradingService);

  constructor(
    private readonly evmRegistryService: EvmRegistryService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
  ) {}

  async createTradingInfo(tradingRule: TradingRule): Promise<TradingInfo | undefined> {
    if (tradingRule.leftAsset.blockchain !== tradingRule.rightAsset.blockchain)
      throw new Error(`Blockchain mismatch in trading rule ${tradingRule.id}`);

    let tradingInfo = await this.getTradingInfo(tradingRule);
    tradingInfo = await this.calculateAmountForPriceImpact(tradingInfo);

    return tradingInfo;
  }

  private async getTradingInfo(tradingRule: TradingRule): Promise<TradingInfo> {
    // get prices
    const referencePrice = await this.pricingService.getPriceFrom(
      tradingRule.source1,
      tradingRule.leftAsset1,
      tradingRule.rightAsset1,
    );

    const checkPrice = await this.pricingService.getPriceFrom(
      tradingRule.source3 ?? tradingRule.source1,
      tradingRule.leftAsset3 ?? tradingRule.leftAsset1,
      tradingRule.rightAsset3 ?? tradingRule.rightAsset1,
    );

    const poolPrice = await this.pricingService.getPriceFrom(
      tradingRule.source2,
      tradingRule.leftAsset2,
      tradingRule.rightAsset2,
      tradingRule.source2 === PriceSource.DEX ? `${tradingRule.poolFee}` : undefined,
    );

    const lowerTargetPrice = referencePrice.price * tradingRule.lowerTarget;
    const upperTargetPrice = referencePrice.price * tradingRule.upperTarget;

    const lowerCheckPrice = checkPrice.price * tradingRule.lowerTarget;
    const upperCheckPrice = checkPrice.price * tradingRule.upperTarget;

    const currentPrice =
      tradingRule.source2 === PriceSource.DEX
        ? poolPrice.price / (1 + EvmUtil.poolFeeFactor(tradingRule.poolFee))
        : poolPrice.price;

    // calculate current deviation
    const lowerDeviation = currentPrice / lowerTargetPrice - 1;
    const upperDeviation = currentPrice / upperTargetPrice - 1;

    const lowerCheckDeviation = currentPrice / lowerCheckPrice - 1;
    const upperCheckDeviation = currentPrice / upperCheckPrice - 1;

    if (lowerDeviation < -tradingRule.lowerLimit && lowerCheckDeviation < -tradingRule.lowerLimit) {
      return {
        price1: lowerTargetPrice,
        price2: currentPrice,
        priceImpact: lowerDeviation,
        poolFee: tradingRule.poolFee,
        assetIn: tradingRule.leftAsset,
        assetOut: tradingRule.rightAsset,
      };
    } else if (upperDeviation > tradingRule.upperLimit && upperCheckDeviation > tradingRule.upperLimit) {
      return {
        price1: upperTargetPrice,
        price2: currentPrice,
        priceImpact: upperDeviation,
        poolFee: tradingRule.poolFee,
        assetIn: tradingRule.rightAsset,
        assetOut: tradingRule.leftAsset,
      };
    } else {
      this.logger.verbose(
        `No action required for trading rule ${tradingRule.id}: lower deviation is ${lowerDeviation} / ${lowerCheckDeviation}, upper deviation is ${upperDeviation} / ${upperCheckDeviation}`,
      );
    }
  }

  private async calculateAmountForPriceImpact(tradingInfo?: TradingInfo): Promise<TradingInfo | undefined> {
    if (!tradingInfo) return;

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
    tradingInfo.amountExpected = targetAmount;

    return tradingInfo;
  }

  private async getPoolContract(client: EvmClient, tradingInfo: TradingInfo): Promise<ethers.Contract> {
    const poolAddress = await client.getPoolAddress(tradingInfo.assetIn, tradingInfo.assetOut, tradingInfo.poolFee);
    return client.getPoolContract(poolAddress);
  }
}
