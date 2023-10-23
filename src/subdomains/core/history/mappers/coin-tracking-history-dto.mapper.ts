import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward, StakingRefType } from '../../staking/entities/staking-ref-reward.entity';
import { PayoutType, StakingReward } from '../../staking/entities/staking-reward.entity';
import { CoinTrackingCsvHistoryDto, CoinTrackingTransactionType } from '../dto/output/coin-tracking-history.dto';

export class CoinTrackingHistoryDtoMapper {
  static mapBuyCryptoCryptoTransactions(buyCryptos: BuyCrypto[]): CoinTrackingCsvHistoryDto[] {
    return buyCryptos
      .filter(
        (buyCrypto) =>
          buyCrypto.amlCheck === CheckStatus.PASS &&
          buyCrypto.inputAmount &&
          buyCrypto.outputAmount &&
          buyCrypto.inputAsset &&
          buyCrypto.outputDate &&
          buyCrypto.txId &&
          buyCrypto.cryptoInput &&
          buyCrypto.cryptoRoute,
      )
      .map((buyCrypto) => [
        {
          type: CoinTrackingTransactionType.DEPOSIT,
          buyAmount: buyCrypto.inputAmount,
          buyAsset: buyCrypto.inputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: buyCrypto.cryptoInput.created,
          txId: buyCrypto.cryptoInput.inTxId,
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: null,
        },
        buyCrypto.inputAsset == buyCrypto.outputAsset?.dexName
          ? buyCrypto.percentFee && buyCrypto.inputAmount && buyCrypto.inputAsset
            ? {
                type: CoinTrackingTransactionType.OTHER_FEE,
                buyAmount: null,
                buyAsset: null,
                sellAmount: buyCrypto.percentFee * buyCrypto.inputAmount,
                sellAsset: this.getAssetSymbol(buyCrypto.inputAsset),
                fee: null,
                feeAsset: null,
                exchange: 'DFX',
                tradeGroup: null,
                comment: 'DFX Purchase Fee',
                date: buyCrypto.outputDate,
                txId: buyCrypto.txId,
                buyValueInEur: null,
                sellValueInEur: buyCrypto.amountInEur,
              }
            : null
          : {
              type: CoinTrackingTransactionType.TRADE,
              buyAmount: buyCrypto.outputAmount,
              buyAsset: buyCrypto.cryptoRoute?.deposit
                ? 'DFI'
                : this.getAssetSymbol(buyCrypto.cryptoRoute?.asset?.dexName),
              sellAmount: buyCrypto.inputAmount,
              sellAsset: this.getAssetSymbol(buyCrypto.inputAsset),
              fee: buyCrypto.percentFee ? buyCrypto.percentFee * buyCrypto.inputAmount : null,
              feeAsset: buyCrypto.percentFee ? this.getAssetSymbol(buyCrypto.inputAsset) : null,
              exchange: 'DFX',
              tradeGroup: null,
              comment: 'DFX Purchase',
              date: buyCrypto.outputDate ? buyCrypto.outputDate : null,
              txId: buyCrypto.txId,
              buyValueInEur: buyCrypto.amountInEur,
              sellValueInEur: buyCrypto.amountInEur,
            },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapBuyCryptoFiatTransactions(buyCryptos: BuyCrypto[]): CoinTrackingCsvHistoryDto[] {
    return buyCryptos
      .filter(
        (buyCrypto) =>
          buyCrypto.amlCheck === CheckStatus.PASS &&
          buyCrypto.inputAmount &&
          buyCrypto.outputAmount &&
          buyCrypto.inputAsset &&
          buyCrypto.bankTx &&
          buyCrypto.outputDate &&
          buyCrypto.txId &&
          buyCrypto.buy,
      )
      .map((buyCrypto) => [
        {
          type: CoinTrackingTransactionType.DEPOSIT,
          buyAmount: buyCrypto.inputAmount,
          buyAsset: buyCrypto.inputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: buyCrypto.outputDate ? this.createRandomDate(buyCrypto.outputDate, -20, buyCrypto.inputAmount) : null,
          txId: buyCrypto.bankTx?.id.toString(),
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.TRADE,
          buyAmount: buyCrypto.outputAmount,
          buyAsset: buyCrypto.buy?.deposit ? 'DFI' : this.getAssetSymbol(buyCrypto.buy?.asset?.dexName),
          sellAmount: buyCrypto.inputAmount,
          sellAsset: buyCrypto.inputAsset,
          fee: buyCrypto.totalFeeAmount
            ? (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount
            : null,
          feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: buyCrypto.outputDate ? buyCrypto.outputDate : null,
          txId: buyCrypto.txId,
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: buyCrypto.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): CoinTrackingCsvHistoryDto[] {
    return buyFiats
      .filter(
        (buyFiat) =>
          buyFiat.amlCheck === CheckStatus.PASS &&
          buyFiat.fiatOutput.bankTx &&
          buyFiat.cryptoInput &&
          buyFiat.outputAmount &&
          buyFiat.outputAsset &&
          buyFiat.inputAmount &&
          buyFiat.fiatOutput.remittanceInfo &&
          buyFiat.fiatOutput.outputDate,
      )
      .map((buyFiat) => [
        {
          type: CoinTrackingTransactionType.TRADE,
          buyAmount: buyFiat.outputAmount,
          buyAsset: buyFiat.outputAsset,
          sellAmount: buyFiat.inputAmount,
          sellAsset: this.getAssetSymbol(buyFiat.cryptoInput.asset?.dexName),
          fee: buyFiat.totalFeeAmount
            ? (buyFiat.totalFeeAmount / buyFiat.inputReferenceAmount) * buyFiat.inputAmount
            : null,
          feeAsset: buyFiat.totalFeeAmount ? buyFiat.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: buyFiat.cryptoInput.created,
          txId: buyFiat.cryptoInput.inTxId,
          buyValueInEur: buyFiat.amountInEur,
          sellValueInEur: buyFiat.amountInEur,
        },
        {
          type: CoinTrackingTransactionType.WITHDRAWAL,
          buyAmount: null,
          buyAsset: null,
          sellAmount: buyFiat.outputAmount,
          sellAsset: buyFiat.outputAsset,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: buyFiat.fiatOutput.outputDate ? buyFiat.fiatOutput.outputDate : null,
          txId: buyFiat.fiatOutput.remittanceInfo,
          buyValueInEur: null,
          sellValueInEur: buyFiat.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingRewards(stakingRewards: StakingReward[]): CoinTrackingCsvHistoryDto[] {
    return stakingRewards
      .map((stakingReward) => [
        {
          type: CoinTrackingTransactionType.STAKING,
          buyAmount: stakingReward.outputAmount,
          buyAsset: this.getAssetSymbol(stakingReward.outputAsset),
          sellAmount: null,
          sellAsset: null,
          fee:
            stakingReward.fee && stakingReward.fee != 0 ? (stakingReward.outputAmount * stakingReward.fee) / (1 - stakingReward.fee) : null,
          feeAsset: stakingReward.fee && stakingReward.fee != 0 ? this.getAssetSymbol(stakingReward.outputAsset) : null,
          exchange: stakingReward.payoutType === PayoutType.REINVEST ? 'DFX Staking' : 'DFX',
          tradeGroup: stakingReward.payoutType === PayoutType.REINVEST ? 'Staking' : null,
          comment: 'DFX Staking Reward',
          date: stakingReward.outputDate,
          txId: stakingReward.txId,
          buyValueInEur: stakingReward.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingDeposits(deposits: CryptoStaking[]): CoinTrackingCsvHistoryDto[] {
    return deposits
      .map((deposit) => [
        {
          type: CoinTrackingTransactionType.DEPOSIT,
          buyAmount: deposit.inputAmount,
          buyAsset: this.getAssetSymbol(deposit.inputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: 'Staking',
          comment: 'DFX Staking Invest',
          date: deposit.inputDate,
          txId: deposit.inTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.WITHDRAWAL,
          buyAmount: null,
          buyAsset: null,
          sellAmount: deposit.inputAmount,
          sellAsset: this.getAssetSymbol(deposit.inputAsset),
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(deposit.inputDate, -10, deposit.inputAmount),
          txId: deposit.inTxId + '-2',
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingWithdrawals(withdrawals: CryptoStaking[]): CoinTrackingCsvHistoryDto[] {
    return withdrawals
      .map((withdrawal) => [
        {
          type: CoinTrackingTransactionType.WITHDRAWAL,
          buyAmount: null,
          buyAsset: null,
          sellAmount: withdrawal.outputAmount,
          sellAsset: this.getAssetSymbol(withdrawal.outputAsset),
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: withdrawal.outputDate,
          txId: withdrawal.outTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.DEPOSIT,
          buyAmount: withdrawal.outputAmount,
          buyAsset: this.getAssetSymbol(withdrawal.outputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(withdrawal.outputDate, 10, withdrawal.outputAmount),
          txId: withdrawal.outTxId + '-2',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        withdrawal.outputAsset != 'DFI'
          ? {
              type: CoinTrackingTransactionType.TRADE,
              buyAmount: withdrawal.outputAmount,
              buyAsset: this.getAssetSymbol(withdrawal.outputAsset),
              sellAmount: withdrawal.inputAmount,
              sellAsset: this.getAssetSymbol(withdrawal.inputAsset),
              fee: null,
              feeAsset: null,
              exchange: 'DFX Staking',
              tradeGroup: null,
              comment: null,
              date: this.createRandomDate(withdrawal.outputDate, -10, withdrawal.inputAmount),
              txId: Util.createHash(
                withdrawal.outputDate.toUTCString() + withdrawal.outputAmount + withdrawal.inputAmount,
              ),
              buyValueInEur: withdrawal.outputAmountInEur,
              sellValueInEur: withdrawal.inputAmountInEur,
            }
          : null,
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((invests) => invests != null);
  }

  static mapRefRewards(refRewards: RefReward[]): CoinTrackingCsvHistoryDto[] {
    return refRewards
      .map((refReward) => [
        {
          type: CoinTrackingTransactionType.REWARD_BONUS,
          buyAmount: refReward.outputAmount,
          buyAsset: refReward.outputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Referral Reward',
          date: refReward.outputDate,
          txId: refReward.txId,
          buyValueInEur: refReward.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingRefRewards(stakingRefRewards: StakingRefReward[]): CoinTrackingCsvHistoryDto[] {
    return stakingRefRewards
      .map((stakingRefReward) => [
        {
          type: CoinTrackingTransactionType.REWARD_BONUS,
          buyAmount: stakingRefReward.outputAmount,
          buyAsset: stakingRefReward.outputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: stakingRefReward.stakingRefType === StakingRefType.REFERRER ? 'DFX' : 'DFX Staking',
          tradeGroup: stakingRefReward.stakingRefType === StakingRefType.REFERRER ? null : 'Staking',
          comment: 'DFX Staking Referral Reward',
          date: stakingRefReward.outputDate,
          txId: stakingRefReward.txId,
          buyValueInEur: stakingRefReward.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private static getAssetSymbol(dexName: string): string {
    // TODO: use col from asset table to differentiate stocks and crypto token?
    return dexName === 'DUSD'
      ? 'DUSD4'
      : ['DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(dexName)
      ? dexName
      : `d${dexName}`;
  }

  private static createRandomDate(outputDate: Date, offset: number, amount: number): Date {
    return new Date(outputDate.getTime() + (offset - (amount % 10)) * 60 * 1000);
  }
}
