import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { HistoryDto } from './dto/history.dto';
import { Util } from 'src/shared/util';
import { DfiTaxService } from 'src/shared/services/dfi-tax.service';
import { StakingRewardService } from '../staking-reward/staking-reward.service';
import { PayoutType, StakingReward } from '../staking-reward/staking-reward.entity';
import { RefRewardService } from '../ref-reward/ref-reward.service';
import { HistoryQuery } from './dto/history-query.dto';
import { CryptoStakingService } from '../crypto-staking/crypto-staking.service';
import { CryptoStaking } from '../crypto-staking/crypto-staking.entity';
import { StakingRefRewardService } from '../staking-ref-reward/staking-ref-reward.service';
import { RefReward } from '../ref-reward/ref-reward.entity';
import { StakingRefReward, StakingRefType } from '../staking-ref-reward/staking-ref-reward.entity';
import { BuyCryptoService } from '../buy-crypto/services/buy-crypto.service';
import { BuyFiatService } from '../buy-fiat/buy-fiat.service';
import { BuyCrypto } from '../buy-crypto/entities/buy-crypto.entity';
import { AmlCheck } from '../buy-crypto/enums/aml-check.enum';

@Injectable()
export class HistoryService {
  constructor(
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly stakingRewardService: StakingRewardService,
    private readonly cryptoStakingService: CryptoStakingService,
    private readonly refRewardService: RefRewardService,
    private readonly dfiTaxService: DfiTaxService,
    private readonly stakingRefReward: StakingRefRewardService,
  ) {}

  async getHistory(userId: number, userAddress: string, query: HistoryQuery, timeout?: number): Promise<HistoryDto[]> {
    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const tx = await Promise.all([
      all || query.buy != null ? await this.getBuyTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.sell != null ? await this.getSellTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.staking != null ? await this.getStakingRewards(userId, query.from, query.to) : Promise.resolve([]),
      all || query.staking != null ? await this.getStakingInvests(userId, query.from, query.to) : Promise.resolve([]),
      all || query.ref != null ? await this.getAllRefRewards(userId, query.from, query.to) : Promise.resolve([]),
      //all || query.lm != null ? await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY, query.from, query.to, timeout): Promise.resolve([]),
    ]).then((tx) => tx.reduce((prev, curr) => prev.concat(curr), []));

    return tx.sort((tx1, tx2) => (Util.secondsDiff(tx1.date, tx2.date) < 0 ? -1 : 1));
  }

  async getHistoryCsv(userId: number, userAddress: string, query: HistoryQuery): Promise<Readable> {
    const tx = await this.getHistory(userId, userAddress, query);
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return Readable.from([this.toCsv(tx)]);
  }

  // --- HELPER METHODS --- //
  private async getBuyTransactions(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const buyTransaction = await this.buyCryptoService.getUserTransactions(userId, dateFrom, dateTo);
    return [...this.getCryptoBuyTransactions(buyTransaction), ...this.getBuyCryptoTransactions(buyTransaction)];
  }

  private getCryptoBuyTransactions(buyCryptos: BuyCrypto[]): HistoryDto[] {
    return buyCryptos
      .filter(
        (c) =>
          c.amlCheck === AmlCheck.PASS &&
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
          buyValueInEur: null,
          sellValueInEur: null,
        },
        c.inputAsset == c.outputAsset
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
                sellValueInEur: null,
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
              buyValueInEur: null,
              sellValueInEur: null,
            },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  private getBuyCryptoTransactions(buyCryptos: BuyCrypto[]): HistoryDto[] {
    return buyCryptos
      .filter(
        (c) =>
          c.amlCheck === AmlCheck.PASS &&
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
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: c.buy?.deposit ? 'DFI' : this.getAssetSymbol(c.buy?.asset?.dexName),
          sellAmount: c.inputAmount,
          sellAsset: c.inputAsset,
          fee: c.percentFee ? c.percentFee * c.inputAmount : null,
          feeAsset: c.percentFee ? c.inputAsset : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Purchase',
          date: c.outputDate ? c.outputDate : null,
          txid: c.txId,
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getSellTransactions(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const buyFiats = await this.buyFiatService.getUserTransactions(userId, dateFrom, dateTo);
    return buyFiats
      .filter(
        (c) =>
          c.amlCheck === AmlCheck.PASS &&
          c.bankTx &&
          c.cryptoInput &&
          c.outputAmount &&
          c.outputAsset &&
          c.inputAmount &&
          c.remittanceInfo &&
          c.outputDate,
      )
      .map((c) => [
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: c.outputAsset,
          sellAmount: c.inputAmount,
          sellAsset: this.getAssetSymbol(c.cryptoInput.asset?.dexName),
          fee: c.percentFee ? c.percentFee * c.inputAmount : null,
          feeAsset: c.percentFee ? this.getAssetSymbol(c.inputAsset) : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: 'DFX Sale',
          date: c.cryptoInput.created,
          txid: c.cryptoInput.inTxId,
          buyValueInEur: null,
          sellValueInEur: null,
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
          date: c.outputDate ? c.outputDate : null,
          txid: c.remittanceInfo,
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getStakingRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const stakingRewards = await this.stakingRewardService
      .getUserRewards([userId], dateFrom, dateTo)
      .then(this.fixDuplicateTxRewards);
    return stakingRewards
      .map((c) => [
        {
          type: 'Staking',
          buyAmount: c.outputAmount,
          buyAsset: this.getAssetSymbol(c.outputAsset),
          sellAmount: null,
          sellAsset: null,
          fee: c.fee ? c.fee * c.inputAmount : null,
          feeAsset: c.fee ? this.getAssetSymbol(c.inputAsset) : null,
          exchange: c.payoutType === PayoutType.REINVEST ? 'DFX Staking' : 'DFX',
          tradeGroup: c.payoutType === PayoutType.REINVEST ? 'Staking' : null,
          comment: 'DFX Staking Reward',
          date: c.outputDate,
          txid: c.txId,
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getStakingInvests(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    let { deposits, withdrawals } = await this.cryptoStakingService
      .getUserInvests(userId, dateFrom, dateTo)
      .then(this.fixDuplicateTxInvest);
    return [...this.getStakingDeposits(deposits), ...this.getStakingWithdrawals(withdrawals)];
  }

  private getStakingDeposits(deposits: CryptoStaking[]): HistoryDto[] {
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

  private getStakingWithdrawals(withdrawals: CryptoStaking[]): HistoryDto[] {
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

  private async getAllRefRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const refRewards = await this.refRewardService.getUserRewards([userId], dateFrom, dateTo);
    const refStakingReward = await this.stakingRefReward.getUserRewards([userId], dateFrom, dateTo);

    return [...this.getRefRewards(refRewards), ...this.getStakingRefRewards(refStakingReward)];
  }

  private getRefRewards(refRewards: RefReward[]): HistoryDto[] {
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
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private getStakingRefRewards(stakingRefRewards: StakingRefReward[]): HistoryDto[] {
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
          buyValueInEur: null,
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
  ): Promise<HistoryDto[]> {
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
    } catch (error) {
      console.error(`Failed to get DFI.tax rewards for ${userAddress}:`, error);
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
    // TODO: new col in asset table to differentiate stocks and crypto token?
    dexName = dexName.replace('-Token', '');

    return dexName === 'DUSD'
      ? 'DUSD4'
      : ['DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(dexName)
      ? dexName
      : `d${dexName}`;
  }

  private fixDuplicateTxRewards(rewards: StakingReward[]): StakingReward[] {
    Array.from(Util.groupBy(rewards, 'txId'))
      .map(([_, rewards]) => rewards)
      .filter((r) => r.length > 1)
      .forEach((rewards) => rewards.forEach((r, i) => (r.txId += i > 0 ? i : '')));

    return rewards;
  }

  private fixDuplicateTxInvest(invests: { deposits: CryptoStaking[]; withdrawals: CryptoStaking[] }): {
    deposits: CryptoStaking[];
    withdrawals: CryptoStaking[];
  } {
    Array.from(Util.groupBy(invests.deposits, 'inTxId'))
      .map(([_, stakingInvests]) => stakingInvests)
      .filter((r) => r.length > 1)
      .forEach((stakingInvests) => stakingInvests.forEach((r, i) => (r.inTxId += i > 0 ? i : '')));

    Array.from(Util.groupBy(invests.withdrawals, 'outTxId'))
      .map(([_, stakingInvests]) => stakingInvests)
      .filter((r) => r.length > 1)
      .forEach((stakingInvests) => stakingInvests.forEach((r, i) => (r.outTxId += i > 0 ? i : '')));

    return invests;
  }
}
