import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward } from '../../staking/entities/staking-ref-reward.entity';
import { PayoutType, StakingReward } from '../../staking/entities/staking-reward.entity';
import {
  ChainReportCsvHistoryDto,
  ChainReportTarget,
  ChainReportTransactionType,
} from '../dto/output/chain-report-history.dto';

export class ChainReportHistoryDtoMapper {
  static mapBuyCryptoCryptoTransactions(buyCryptos: BuyCrypto[]): ChainReportCsvHistoryDto[] {
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
          timestamp: buyCrypto.cryptoInput.created,
          transactionType: ChainReportTransactionType.DEPOSIT,
          inputAmount: buyCrypto.inputAmount,
          inputAsset: buyCrypto.inputAsset,
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: buyCrypto.cryptoInput.inTxId,
          description: 'DFX Purchase',
        },
        buyCrypto.inputAsset == buyCrypto.outputAsset?.dexName
          ? buyCrypto.percentFee && buyCrypto.inputAmount && buyCrypto.inputAsset
            ? {
                timestamp: buyCrypto.outputDate,
                transactionType: ChainReportTransactionType.FEE,
                inputAmount: null,
                inputAsset: null,
                outputAmount: buyCrypto.percentFee * buyCrypto.inputAmount,
                outputAsset: this.getAssetSymbol(
                  buyCrypto.cryptoInput.asset.dexName,
                  buyCrypto.cryptoInput.asset.blockchain,
                ),
                feeAmount: null,
                feeAsset: null,
                txid: buyCrypto.txId,
                description: 'DFX Purchase Fee',
              }
            : null
          : {
              timestamp: buyCrypto.outputDate ? buyCrypto.outputDate : null,
              transactionType: ChainReportTransactionType.TRADE,
              inputAmount: buyCrypto.inputAmount,
              inputAsset: this.getAssetSymbol(
                buyCrypto.cryptoInput.asset.dexName,
                buyCrypto.cryptoInput.asset.blockchain,
              ),
              outputAmount: buyCrypto.outputAmount,
              outputAsset: this.getAssetSymbol(
                buyCrypto.cryptoRoute.asset?.dexName,
                buyCrypto.cryptoRoute.asset?.blockchain,
              ),
              feeAmount: buyCrypto.totalFeeAmount
                ? (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount
                : null,
              feeAsset: buyCrypto.totalFeeAmount
                ? this.getAssetSymbol(buyCrypto.cryptoInput.asset.dexName, buyCrypto.cryptoInput.asset.blockchain)
                : null,
              txid: buyCrypto.txId,
              description: 'DFX Purchase',
            },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapBuyCryptoFiatTransactions(buyCryptos: BuyCrypto[]): ChainReportCsvHistoryDto[] {
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
          timestamp: buyCrypto.outputDate
            ? this.createRandomDate(buyCrypto.outputDate, -20, buyCrypto.inputAmount)
            : null,
          transactionType: ChainReportTransactionType.DEPOSIT,
          inputAmount: buyCrypto.inputAmount,
          inputAsset: buyCrypto.inputAsset,
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: buyCrypto.bankTx?.id.toString(),
          description: 'DFX Purchase',
        },
        {
          timestamp: buyCrypto.outputDate ? buyCrypto.outputDate : null,
          transactionType: ChainReportTransactionType.TRADE,
          inputAmount: buyCrypto.inputAmount,
          inputAsset: buyCrypto.inputAsset,
          outputAmount: buyCrypto.outputAmount,
          outputAsset: this.getAssetSymbol(buyCrypto.buy.asset.dexName, buyCrypto.buy.asset.blockchain),
          feeAmount: buyCrypto.totalFeeAmount
            ? (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount
            : null,
          feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
          txid: buyCrypto.txId,
          description: 'DFX Purchase',
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): ChainReportCsvHistoryDto[] {
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
          timestamp: buyFiat.cryptoInput.created,
          transactionType: ChainReportTransactionType.TRADE,
          inputAmount: buyFiat.inputAmount,
          inputAsset: this.getAssetSymbol(buyFiat.cryptoInput.asset?.dexName, buyFiat.cryptoInput.asset?.blockchain),
          outputAmount: buyFiat.outputAmount,
          outputAsset: buyFiat.outputAsset.name,
          feeAmount: buyFiat.totalFeeAmount
            ? (buyFiat.totalFeeAmount / buyFiat.inputReferenceAmount) * buyFiat.inputAmount
            : null,
          feeAsset: buyFiat.totalFeeAmount
            ? this.getAssetSymbol(buyFiat.cryptoInput.asset?.dexName, buyFiat.cryptoInput.asset?.blockchain)
            : null,
          txid: buyFiat.cryptoInput.inTxId,
          description: 'DFX Sale',
        },
        {
          timestamp: buyFiat.fiatOutput.outputDate ? buyFiat.fiatOutput.outputDate : null,
          transactionType: ChainReportTransactionType.WITHDRAWAL,
          inputAmount: null,
          inputAsset: null,
          outputAmount: buyFiat.outputAmount,
          outputAsset: buyFiat.outputAsset.name,
          feeAmount: null,
          feeAsset: null,
          txid: buyFiat.fiatOutput.remittanceInfo,
          description: 'DFX Sale',
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingRewards(stakingRewards: StakingReward[]): ChainReportCsvHistoryDto[] {
    return stakingRewards
      .map((stakingReward) => [
        {
          timestamp: stakingReward.outputDate,
          transactionType: ChainReportTransactionType.STAKING,
          inputAmount: stakingReward.outputAmount,
          inputAsset: this.getAssetSymbol(stakingReward.outputAsset, Blockchain.DEFICHAIN),
          outputAmount: null,
          outputAsset: null,
          feeAmount:
            stakingReward.fee && stakingReward.fee != 0
              ? (stakingReward.outputAmount * stakingReward.fee) / (1 - stakingReward.fee)
              : null,
          feeAsset:
            stakingReward.fee && stakingReward.fee != 0
              ? this.getAssetSymbol(stakingReward.outputAsset, Blockchain.DEFICHAIN)
              : null,
          txid: stakingReward.txId,
          description: 'DFX Staking Reward',
          isReinvest: stakingReward.payoutType === PayoutType.REINVEST,
          target:
            stakingReward.payoutType === PayoutType.REINVEST ? ChainReportTarget.STAKING : ChainReportTarget.WALLET,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingDeposits(deposits: CryptoStaking[]): ChainReportCsvHistoryDto[] {
    return deposits
      .map((deposit) => [
        {
          timestamp: deposit.inputDate,
          transactionType: ChainReportTransactionType.DEPOSIT,
          inputAmount: deposit.inputAmount,
          inputAsset: this.getAssetSymbol(deposit.inputAsset, Blockchain.DEFICHAIN),
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: deposit.inTxId + '-1',
          description: 'DFX Staking Invest',
        },
        {
          timestamp: this.createRandomDate(deposit.inputDate, -10, deposit.inputAmount),
          transactionType: ChainReportTransactionType.WITHDRAWAL,
          inputAmount: null,
          inputAsset: null,
          outputAmount: deposit.inputAmount,
          outputAsset: this.getAssetSymbol(deposit.inputAsset, Blockchain.DEFICHAIN),
          feeAmount: null,
          feeAsset: null,
          txid: deposit.inTxId + '-2',
          description: 'DFX Staking Invest',
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingWithdrawals(withdrawals: CryptoStaking[]): ChainReportCsvHistoryDto[] {
    return withdrawals
      .map((withdrawal) => [
        {
          timestamp: withdrawal.outputDate,
          transactionType: ChainReportTransactionType.WITHDRAWAL,
          inputAmount: null,
          inputAsset: null,
          outputAmount: withdrawal.outputAmount,
          outputAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
          feeAmount: null,
          feeAsset: null,
          txid: withdrawal.outTxId + '-1',
          description: 'DFX Staking Invest',
        },
        {
          timestamp: this.createRandomDate(withdrawal.outputDate, 10, withdrawal.outputAmount),
          transactionType: ChainReportTransactionType.DEPOSIT,
          inputAmount: withdrawal.outputAmount,
          inputAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: withdrawal.outTxId + '-2',
          description: 'DFX Staking Invest',
        },
        withdrawal.outputAsset != 'DFI'
          ? {
              timestamp: this.createRandomDate(withdrawal.outputDate, -10, withdrawal.inputAmount),
              transactionType: ChainReportTransactionType.TRADE,
              inputAmount: withdrawal.outputAmount,
              inputAsset: this.getAssetSymbol(withdrawal.outputAsset, Blockchain.DEFICHAIN),
              outputAmount: withdrawal.inputAmount,
              outputAsset: this.getAssetSymbol(withdrawal.inputAsset, Blockchain.DEFICHAIN),
              feeAmount: null,
              feeAsset: null,
              txid: Util.createHash(
                withdrawal.outputDate.toUTCString() + withdrawal.outputAmount + withdrawal.inputAmount,
              ),
              description: null,
            }
          : null,
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((invests) => invests != null);
  }

  static mapRefRewards(refRewards: RefReward[]): ChainReportCsvHistoryDto[] {
    return refRewards
      .map((refReward) => [
        {
          timestamp: refReward.outputDate,
          transactionType: ChainReportTransactionType.REFERRAL_REWARD,
          inputAmount: refReward.outputAmount,
          inputAsset: refReward.outputAsset,
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: refReward.txId,
          description: 'DFX Referral Reward',
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  static mapStakingRefRewards(stakingRefRewards: StakingRefReward[]): ChainReportCsvHistoryDto[] {
    return stakingRefRewards
      .map((stakingRefReward) => [
        {
          timestamp: stakingRefReward.outputDate,
          transactionType: ChainReportTransactionType.REFERRAL_REWARD,
          inputAmount: stakingRefReward.outputAmount,
          inputAsset: stakingRefReward.outputAsset,
          outputAmount: null,
          outputAsset: null,
          feeAmount: null,
          feeAsset: null,
          txid: stakingRefReward.txId,
          description: 'DFX Staking Referral Reward',
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
