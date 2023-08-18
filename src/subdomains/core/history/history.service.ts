import { Injectable, NotFoundException } from '@nestjs/common';
import { DfiTaxService } from 'src/integration/blockchain/ain/services/dfi-tax.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Readable } from 'stream';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from '../buy-crypto/process/enums/check-status.enum';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';
import { RefReward } from '../referral/reward/ref-reward.entity';
import { RefRewardService } from '../referral/reward/ref-reward.service';
import { BuyFiatService } from '../sell-crypto/process/buy-fiat.service';
import { CryptoStaking } from '../staking/entities/crypto-staking.entity';
import { StakingRefReward, StakingRefType } from '../staking/entities/staking-ref-reward.entity';
import { PayoutType } from '../staking/entities/staking-reward.entity';
import { StakingService } from '../staking/services/staking.service';
import { CoinTrackingHistory } from './dto/coin-tracking-history.dto';
import { HistoryQuery } from './dto/history-query.dto';

@Injectable()
export class HistoryService {
  private readonly logger = new DfxLogger(HistoryService);

  constructor(
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly stakingService: StakingService,
    private readonly refRewardService: RefRewardService,
    private readonly dfiTaxService: DfiTaxService,
  ) {}

  async getHistory(
    userId: number,
    userAddress: string,
    query: HistoryQuery,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    timeout?: number,
  ): Promise<CoinTrackingHistory[]> {
    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const transactions: CoinTrackingHistory[] = await Promise.all([
      all || query.buy != null ? await this.getBuyTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.sell != null ? await this.getSellTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.staking != null ? await this.getStakingRewards(userId, query.from, query.to) : Promise.resolve([]),
      all || query.staking != null ? await this.getStakingInvests(userId, query.from, query.to) : Promise.resolve([]),
      all || query.ref != null ? await this.getAllRefRewards(userId, query.from, query.to) : Promise.resolve([]),
      //all || query.lm != null ? await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY, query.from, query.to, timeout): Promise.resolve([]),
    ]).then((r) => r.reduce((prev, curr) => prev.concat(curr), []));

    return this.fixDuplicateTx(transactions).sort((tx1, tx2) => (tx1.date.getTime() > tx2.date.getTime() ? -1 : 1));
  }

  async getHistoryCsv(userId: number, userAddress: string, query: HistoryQuery): Promise<Readable> {
    const tx = await this.getHistory(userId, userAddress, query);
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return Readable.from([this.toCsv(tx)]);
  }

  // --- HELPER METHODS --- //
  private async getBuyTransactions(userId: number, dateFrom?: Date, dateTo?: Date): Promise<CoinTrackingHistory[]> {
    const buyTransaction = await this.buyCryptoService.getUserTransactions(userId, dateFrom, dateTo);
    return [...this.getCryptoBuyTransactions(buyTransaction), ...this.getBuyCryptoTransactions(buyTransaction)];
  }

  private getCryptoBuyTransactions(buyCryptos: BuyCrypto[]): CoinTrackingHistory[] {
    return buyCryptos
      .filter(
        (c) =>
          c.amlCheck === CheckStatus.PASS &&
          c.inputAmount &&
          c.outputAmount &&
          c.inputAsset &&
          c.outputDate &&
          c.txId &&
          c.cryptoInput &&
          c.cryptoRoute,
      )
      .map((c) => [
        {
          type: 'Deposit',
          buyAmount: c.inputAmount,
          buyAsset: c.inputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: c.cryptoInput.created,
          txid: c.cryptoInput.inTxId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: null,
        },
        c.inputAsset == c.outputAsset?.dexName
          ? c.percentFee && c.inputAmount && c.inputAsset
            ? {
                type: 'Other Fee',
                buyAmount: null,
                buyAsset: null,
                sellAmount: c.percentFee * c.inputAmount,
                sellAsset: this.getAssetSymbol(c.inputAsset),
                fee: null,
                feeAsset: null,
                exchange: 'DFX',
                tradeGroup: null,
                comment: 'DFX Purchase Fee',
                date: c.outputDate,
                txid: c.txId,
                buyValueInEur: null,
                sellValueInEur: c.amountInEur,
              }
            : null
          : {
              type: 'Trade',
              buyAmount: c.outputAmount,
              buyAsset: c.cryptoRoute?.deposit ? 'DFI' : this.getAssetSymbol(c.cryptoRoute?.asset?.dexName),
              sellAmount: c.inputAmount,
              sellAsset: this.getAssetSymbol(c.inputAsset),
              fee: c.percentFee ? c.percentFee * c.inputAmount : null,
              feeAsset: c.percentFee ? this.getAssetSymbol(c.inputAsset) : null,
              exchange: 'DFX',
              tradeGroup: null,
              comment: 'DFX Purchase',
              date: c.outputDate ? c.outputDate : null,
              txid: c.txId,
              buyValueInEur: c.amountInEur,
              sellValueInEur: c.amountInEur,
            },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  private getBuyCryptoTransactions(buyCryptos: BuyCrypto[]): CoinTrackingHistory[] {
    return buyCryptos
      .filter(
        (c) =>
          c.amlCheck === CheckStatus.PASS &&
          c.inputAmount &&
          c.outputAmount &&
          c.inputAsset &&
          c.bankTx &&
          c.outputDate &&
          c.txId &&
          c.buy,
      )
      .map((c) => [
        {
          type: 'Deposit',
          buyAmount: c.inputAmount,
          buyAsset: c.inputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: c.outputDate ? this.createRandomDate(c.outputDate, -20, c.inputAmount) : null,
          txid: c.bankTx?.id.toString(),
          buyValueInEur: c.amountInEur,
          sellValueInEur: null,
        },
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: c.buy?.deposit ? 'DFI' : this.getAssetSymbol(c.buy?.asset?.dexName),
          sellAmount: c.inputAmount,
          sellAsset: c.inputAsset,
          fee: c.totalFeeAmount ? (c.totalFeeAmount / c.inputReferenceAmount) * c.inputAmount : null,
          feeAsset: c.totalFeeAmount ? c.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: c.outputDate ? c.outputDate : null,
          txid: c.txId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: c.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getSellTransactions(userId: number, dateFrom?: Date, dateTo?: Date): Promise<CoinTrackingHistory[]> {
    const buyFiats = await this.buyFiatService.getUserTransactions(userId, dateFrom, dateTo);
    return buyFiats
      .filter(
        (c) =>
          c.amlCheck === CheckStatus.PASS &&
          c.fiatOutput.bankTx &&
          c.cryptoInput &&
          c.outputAmount &&
          c.outputAsset &&
          c.inputAmount &&
          c.fiatOutput.remittanceInfo &&
          c.fiatOutput.outputDate,
      )
      .map((c) => [
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: c.outputAsset,
          sellAmount: c.inputAmount,
          sellAsset: this.getAssetSymbol(c.cryptoInput.asset?.dexName),
          fee: c.totalFeeAmount ? (c.totalFeeAmount / c.inputReferenceAmount) * c.inputAmount : null,
          feeAsset: c.totalFeeAmount ? c.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: c.cryptoInput.created,
          txid: c.cryptoInput.inTxId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: c.amountInEur,
        },
        {
          type: 'Withdrawal',
          buyAmount: null,
          buyAsset: null,
          sellAmount: c.outputAmount,
          sellAsset: c.outputAsset,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: c.fiatOutput.outputDate ? c.fiatOutput.outputDate : null,
          txid: c.fiatOutput.remittanceInfo,
          buyValueInEur: null,
          sellValueInEur: c.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getStakingRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<CoinTrackingHistory[]> {
    const stakingRewards = await this.stakingService.getUserStakingRewards([userId], dateFrom, dateTo);
    return stakingRewards
      .map((c) => [
        {
          type: 'Staking',
          buyAmount: c.outputAmount,
          buyAsset: this.getAssetSymbol(c.outputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: c.fee && c.fee != 0 ? (c.outputAmount * c.fee) / (1 - c.fee) : null,
          feeAsset: c.fee && c.fee != 0 ? this.getAssetSymbol(c.outputAsset) : null,
          exchange: c.payoutType === PayoutType.REINVEST ? 'DFX Staking' : 'DFX',
          tradeGroup: c.payoutType === PayoutType.REINVEST ? 'Staking' : null,
          comment: 'DFX Staking Reward',
          date: c.outputDate,
          txid: c.txId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getStakingInvests(userId: number, dateFrom?: Date, dateTo?: Date): Promise<CoinTrackingHistory[]> {
    const { deposits, withdrawals } = await this.stakingService.getUserInvests(userId, dateFrom, dateTo);
    return [...this.getStakingDeposits(deposits), ...this.getStakingWithdrawals(withdrawals)];
  }

  private getStakingDeposits(deposits: CryptoStaking[]): CoinTrackingHistory[] {
    return deposits
      .map((c) => [
        {
          type: 'Deposit',
          buyAmount: c.inputAmount,
          buyAsset: this.getAssetSymbol(c.inputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: 'Staking',
          comment: 'DFX Staking Invest',
          date: c.inputDate,
          txid: c.inTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: 'Withdrawal',
          buyAmount: null,
          buyAsset: null,
          sellAmount: c.inputAmount,
          sellAsset: this.getAssetSymbol(c.inputAsset),
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(c.inputDate, -10, c.inputAmount),
          txid: c.inTxId + '-2',
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private getStakingWithdrawals(withdrawals: CryptoStaking[]): CoinTrackingHistory[] {
    return withdrawals
      .map((c) => [
        {
          type: 'Withdrawal',
          buyAmount: null,
          buyAsset: null,
          sellAmount: c.outputAmount,
          sellAsset: this.getAssetSymbol(c.outputAsset),
          fee: null,
          feeAsset: null,
          exchange: 'DFX Staking',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: c.outputDate,
          txid: c.outTxId + '-1',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: 'Deposit',
          buyAmount: c.outputAmount,
          buyAsset: this.getAssetSymbol(c.outputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Staking Invest',
          date: this.createRandomDate(c.outputDate, 10, c.outputAmount),
          txid: c.outTxId + '-2',
          buyValueInEur: null,
          sellValueInEur: null,
        },
        c.outputAsset != 'DFI'
          ? {
              type: 'Trade',
              buyAmount: c.outputAmount,
              buyAsset: this.getAssetSymbol(c.outputAsset),
              sellAmount: c.inputAmount,
              sellAsset: this.getAssetSymbol(c.inputAsset),
              fee: null,
              feeAsset: null,
              exchange: 'DFX Staking',
              tradeGroup: null,
              comment: null,
              date: this.createRandomDate(c.outputDate, -10, c.inputAmount),
              txid: Util.createHash(c.outputDate.toUTCString() + c.outputAmount + c.inputAmount),
              buyValueInEur: c.outputAmountInEur,
              sellValueInEur: c.inputAmountInEur,
            }
          : null,
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((invests) => invests != null);
  }

  private async getAllRefRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<CoinTrackingHistory[]> {
    const refRewards = await this.refRewardService.getUserRewards([userId], dateFrom, dateTo);
    const refStakingReward = await this.stakingService.getUserStakingRefRewards([userId], dateFrom, dateTo);

    return [...this.getRefRewards(refRewards), ...this.getStakingRefRewards(refStakingReward)];
  }

  private getRefRewards(refRewards: RefReward[]): CoinTrackingHistory[] {
    return refRewards
      .map((c) => [
        {
          type: 'Reward / Bonus',
          buyAmount: c.outputAmount,
          buyAsset: c.outputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Referral Reward',
          date: c.outputDate,
          txid: c.txId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private getStakingRefRewards(stakingRefRewards: StakingRefReward[]): CoinTrackingHistory[] {
    return stakingRefRewards
      .map((c) => [
        {
          type: 'Reward / Bonus',
          buyAmount: c.outputAmount,
          buyAsset: c.outputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: c.stakingRefType === StakingRefType.REFERRER ? 'DFX' : 'DFX Staking',
          tradeGroup: c.stakingRefType === StakingRefType.REFERRER ? null : 'Staking',
          comment: 'DFX Staking Referral Reward',
          date: c.outputDate,
          txid: c.txId,
          buyValueInEur: c.amountInEur,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getDfiTaxRewards(
    userAddress: string,
    interval: string,
    dateFrom?: Date,
    dateTo?: Date,
    timeout?: number,
  ): Promise<CoinTrackingHistory[]> {
    try {
      const rewards = await this.dfiTaxService.getRewards(userAddress, interval, dateFrom, dateTo, timeout);
      return rewards.map((reward) => ({
        type: 'Mining',
        buyAmount: Util.round(reward.qty, 8),
        buyAsset: this.getAssetSymbol(reward.token),
        sellAmount: null,
        sellAsset: null,
        fee: null,
        feeAsset: null,
        exchange: 'DFX',
        tradeGroup: null,
        comment: `Liquidity Mining ${reward.category} ${reward.pool}`,
        date: new Date(reward.date),
        txid: Util.createHash(reward.date + reward.qty),
        buyValueInEur: Util.round(reward.value_open, 8),
        sellValueInEur: null,
      }));
    } catch (e) {
      this.logger.error(`Failed to get DFI.tax rewards for ${userAddress}:`, e);
      return [];
    }
  }

  private toCsv(list: any[], separator = ','): string {
    const headers = Object.keys(list[0]).join(separator);
    const values = list.map((t) =>
      Object.values(t)
        .map((v) => (v instanceof Date ? v.toISOString() : v))
        .join(separator),
    );
    return [headers].concat(values).join('\n');
  }

  private createRandomDate(outputDate: Date, offset: number, amount: number): Date {
    return new Date(outputDate.getTime() + (offset - (amount % 10)) * 60 * 1000);
  }

  private getAssetSymbol(dexName: string): string {
    // TODO: use col from asset table to differentiate stocks and crypto token?
    return dexName === 'DUSD'
      ? 'DUSD4'
      : ['DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(dexName)
      ? dexName
      : `d${dexName}`;
  }

  private fixDuplicateTx(rewards: CoinTrackingHistory[]): CoinTrackingHistory[] {
    Array.from(Util.groupBy(rewards, 'txid'))
      .map(([_, rewards]) => rewards)
      .filter((r) => r.length > 1)
      .forEach((rewards) => rewards.forEach((r, i) => (r.txid += i > 0 ? i : '')));

    return rewards;
  }
}
