import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmountType, Util } from 'src/shared/utils/util';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward, StakingRefType } from '../../staking/entities/staking-ref-reward.entity';
import { PayoutType, StakingReward } from '../../staking/entities/staking-reward.entity';
import {
  CoinTrackingApiHistoryDto,
  CoinTrackingCsvHistoryDto,
  CoinTrackingTransactionType,
} from '../dto/output/coin-tracking-history.dto';

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
          txid: buyCrypto.cryptoInput.inTxId,
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: null,
        },
        buyCrypto.inputAsset == buyCrypto.outputAsset?.dexName
          ? buyCrypto.percentFee && buyCrypto.inputAmount && buyCrypto.inputAsset
            ? {
                type: CoinTrackingTransactionType.OTHER_FEE,
                buyAmount: null,
                buyAsset: null,
                sellAmount: buyCrypto.totalFeeAmount,
                sellAsset: this.getAssetSymbol(
                  buyCrypto.cryptoInput.asset.dexName,
                  buyCrypto.cryptoInput.asset.blockchain,
                ),
                fee: null,
                feeAsset: null,
                exchange: 'DFX',
                tradeGroup: null,
                comment: 'DFX Purchase Fee',
                date: buyCrypto.outputDate,
                txid: buyCrypto.txId,
                buyValueInEur: null,
                sellValueInEur: Util.roundReadable(
                  (buyCrypto.amountInEur / buyCrypto.amountInChf) * buyCrypto.totalFeeAmountChf,
                  AmountType.FIAT,
                ),
              }
            : null
          : {
              type: CoinTrackingTransactionType.TRADE,
              buyAmount: buyCrypto.outputAmount,
              buyAsset: this.getAssetSymbol(
                buyCrypto.cryptoRoute?.asset?.dexName,
                buyCrypto.cryptoRoute?.asset?.blockchain,
              ),
              sellAmount: buyCrypto.inputAmount,
              sellAsset: this.getAssetSymbol(
                buyCrypto.cryptoInput.asset.dexName,
                buyCrypto.cryptoInput.asset.blockchain,
              ),
              fee: buyCrypto.totalFeeAmount
                ? Util.roundReadable(
                    (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount,
                    AmountType.ASSET_FEE,
                  )
                : null,
              feeAsset: buyCrypto.totalFeeAmount
                ? this.getAssetSymbol(buyCrypto.cryptoInput.asset.dexName, buyCrypto.cryptoInput.asset.blockchain)
                : null,
              exchange: 'DFX',
              tradeGroup: null,
              comment: 'DFX Purchase',
              date: buyCrypto.outputDate ? buyCrypto.outputDate : null,
              txid: buyCrypto.txId,
              buyValueInEur: buyCrypto.amountInEur,
              sellValueInEur: buyCrypto.amountInEur,
            },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapBuyCryptoCryptoTransactionsForApi(buyCryptos: BuyCrypto[]): CoinTrackingApiHistoryDto[] {
    return this.mapBuyCryptoCryptoTransactions(buyCryptos).map((t) => {
      return { ...t, date: t.date?.getTime() / 1000 };
    });
  }

  static mapBuyCryptoFiatTransactions(buyCryptos: BuyCrypto[]): CoinTrackingCsvHistoryDto[] {
    return buyCryptos
      .filter(
        (buyCrypto) =>
          buyCrypto.amlCheck === CheckStatus.PASS &&
          buyCrypto.inputAmount &&
          buyCrypto.outputAmount &&
          buyCrypto.inputAsset &&
          (buyCrypto.bankTx || buyCrypto.checkoutTx) &&
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
          txid:
            buyCrypto.bankTx?.id.toString() ??
            (buyCrypto.checkoutTx ? `CC-${buyCrypto.checkoutTx?.id.toString()}` : undefined),
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.TRADE,
          buyAmount: buyCrypto.outputAmount,
          buyAsset: this.getAssetSymbol(buyCrypto.buy.asset.dexName, buyCrypto.buy.asset.blockchain),
          sellAmount: buyCrypto.inputAmount,
          sellAsset: buyCrypto.inputAsset,
          fee: buyCrypto.totalFeeAmount
            ? Util.roundReadable(
                (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount,
                AmountType.FIAT_FEE,
              )
            : null,
          feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: buyCrypto.outputDate ? buyCrypto.outputDate : null,
          txid: buyCrypto.txId,
          buyValueInEur: buyCrypto.amountInEur,
          sellValueInEur: buyCrypto.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapBuyCryptoFiatTransactionsForApi(buyCryptos: BuyCrypto[]): CoinTrackingApiHistoryDto[] {
    return this.mapBuyCryptoFiatTransactions(buyCryptos).map((t) => {
      return { ...t, date: t.date?.getTime() / 1000 };
    });
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): CoinTrackingCsvHistoryDto[] {
    return buyFiats
      .filter(
        (buyFiat) =>
          buyFiat.amlCheck === CheckStatus.PASS &&
          buyFiat.cryptoInput &&
          buyFiat.outputAmount &&
          buyFiat.outputAsset &&
          buyFiat.inputAmount &&
          buyFiat.fiatOutput?.remittanceInfo &&
          buyFiat.fiatOutput?.outputDate,
      )
      .map((buyFiat) => [
        {
          type: CoinTrackingTransactionType.TRADE,
          buyAmount: buyFiat.outputAmount,
          buyAsset: buyFiat.outputAsset.name,
          sellAmount: buyFiat.inputAmount,
          sellAsset: this.getAssetSymbol(buyFiat.cryptoInput.asset.dexName, buyFiat.cryptoInput.asset.blockchain),
          fee: buyFiat.totalFeeAmount
            ? Util.roundReadable(
                (buyFiat.totalFeeAmount / buyFiat.inputReferenceAmount) * buyFiat.inputAmount,
                AmountType.ASSET_FEE,
              )
            : null,
          feeAsset: buyFiat.totalFeeAmount
            ? this.getAssetSymbol(buyFiat.cryptoInput.asset.dexName, buyFiat.cryptoInput.asset.blockchain)
            : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: buyFiat.cryptoInput.created,
          txid: buyFiat.cryptoInput.inTxId,
          buyValueInEur: buyFiat.amountInEur,
          sellValueInEur: buyFiat.amountInEur,
        },
        {
          type: CoinTrackingTransactionType.WITHDRAWAL,
          buyAmount: null,
          buyAsset: null,
          sellAmount: buyFiat.outputAmount,
          sellAsset: buyFiat.outputAsset.name,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: buyFiat.fiatOutput.outputDate ? buyFiat.fiatOutput.outputDate : null,
          txid: buyFiat.fiatOutput.remittanceInfo,
          buyValueInEur: null,
          sellValueInEur: buyFiat.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapBuyFiatTransactionsForApi(buyFiats: BuyFiat[]): CoinTrackingApiHistoryDto[] {
    return this.mapBuyFiatTransactions(buyFiats).map((t) => {
      return { ...t, date: t.date?.getTime() / 1000 };
    });
  }

  static mapStakingRewards(stakingRewards: StakingReward[]): CoinTrackingCsvHistoryDto[] {
    return stakingRewards
      .map((stakingReward) => [
        {
          type: CoinTrackingTransactionType.STAKING,
          buyAmount: stakingReward.outputAmount,
          buyAsset: this.getAssetSymbol(stakingReward.outputAsset.dexName, Blockchain.DEFICHAIN),
          sellAmount: null,
          sellAsset: null,
          fee:
            stakingReward.fee && stakingReward.fee != 0
              ? (stakingReward.outputAmount * stakingReward.fee) / (1 - stakingReward.fee)
              : null,
          feeAsset:
            stakingReward.fee && stakingReward.fee != 0
              ? this.getAssetSymbol(stakingReward.outputAsset.dexName, Blockchain.DEFICHAIN)
              : null,
          exchange: stakingReward.payoutType === PayoutType.REINVEST ? 'DFX Staking' : 'DFX',
          tradeGroup: stakingReward.payoutType === PayoutType.REINVEST ? 'Staking' : null,
          comment: 'DFX Staking Reward',
          date: stakingReward.outputDate,
          txid: stakingReward.txId,
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
          buyAsset: this.getAssetSymbol(deposit.inputAsset, Blockchain.DEFICHAIN),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: 'Staking',
          comment: 'DFX Staking Invest',
          date: deposit.inputDate,
          txid: deposit.inTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.WITHDRAWAL,
          buyAmount: null,
          buyAsset: null,
          sellAmount: deposit.inputAmount,
          sellAsset: this.getAssetSymbol(deposit.inputAsset, Blockchain.DEFICHAIN),
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(deposit.inputDate, -10, deposit.inputAmount),
          txid: deposit.inTxId + '-2',
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
          sellAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: withdrawal.outputDate,
          txid: withdrawal.outTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: CoinTrackingTransactionType.DEPOSIT,
          buyAmount: withdrawal.outputAmount,
          buyAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(withdrawal.outputDate, 10, withdrawal.outputAmount),
          txid: withdrawal.outTxId + '-2',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        withdrawal.outputAsset != 'DFI'
          ? {
              type: CoinTrackingTransactionType.TRADE,
              buyAmount: withdrawal.outputAmount,
              buyAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
              sellAmount: withdrawal.inputAmount,
              sellAsset: this.getAssetSymbol(withdrawal.inputAsset, Blockchain.DEFICHAIN),
              fee: null,
              feeAsset: null,
              exchange: 'DFX Staking',
              tradeGroup: null,
              comment: null,
              date: this.createRandomDate(withdrawal.outputDate, -10, withdrawal.inputAmount),
              txid: Util.createHash(
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
          buyAsset: refReward.outputAsset.dexName,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Referral Reward',
          date: refReward.outputDate,
          txid: refReward.txId,
          buyValueInEur: refReward.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapRefRewardsForApi(refRewards: RefReward[]): CoinTrackingApiHistoryDto[] {
    return this.mapRefRewards(refRewards).map((t) => {
      return { ...t, date: t.date?.getTime() / 1000 };
    });
  }

  static mapStakingRefRewards(stakingRefRewards: StakingRefReward[]): CoinTrackingCsvHistoryDto[] {
    return stakingRefRewards
      .map((stakingRefReward) => [
        {
          type: CoinTrackingTransactionType.REWARD_BONUS,
          buyAmount: stakingRefReward.outputAmount,
          buyAsset: stakingRefReward.outputAsset.dexName,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: stakingRefReward.stakingRefType === StakingRefType.REFERRER ? 'DFX' : 'DFX Staking',
          tradeGroup: stakingRefReward.stakingRefType === StakingRefType.REFERRER ? null : 'Staking',
          comment: 'DFX Staking Referral Reward',
          date: stakingRefReward.outputDate,
          txid: stakingRefReward.txId,
          buyValueInEur: stakingRefReward.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private static getAssetSymbol(assetName: string, blockchain: Blockchain): string {
    switch (blockchain) {
      case Blockchain.DEFICHAIN:
        return assetName === 'DUSD'
          ? 'DUSD4'
          : ['DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(assetName)
          ? assetName
          : `d${assetName}`;

      default:
        return assetName;
    }
  }

  private static createRandomDate(outputDate: Date, offset: number, amount: number): Date {
    return new Date(outputDate.getTime() + (offset - (amount % 10)) * 60 * 1000);
  }
}
