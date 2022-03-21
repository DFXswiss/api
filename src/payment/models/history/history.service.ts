import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { CoinTrackingHistoryDto, HistoryDto } from './dto/history.dto';
import { Util } from 'src/shared/util';
import { DfiTaxInterval, DfiTaxService } from 'src/shared/services/dfi-tax.service';
import { StakingRewardService } from '../staking-reward/staking-reward.service';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { RefRewardService } from '../ref-reward/ref-reward.service';
import { HistoryQuery } from './dto/history-query.dto';
import { CryptoBuyService } from '../crypto-buy/crypto-buy.service';
import { CryptoSellService } from '../crypto-sell/crypto-sell.service';

@Injectable()
export class HistoryService {
  constructor(
    private readonly cryptoBuyService: CryptoBuyService,
    private readonly cryptoSellService: CryptoSellService,
    private readonly stakingRewardService: StakingRewardService,
    private readonly refRewardService: RefRewardService,
    private readonly dfiTaxService: DfiTaxService,
  ) {}

  async getHistory(userId: number, userAddress: string, query: HistoryQuery, timeout?: number): Promise<HistoryDto[]> {
    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const tx = await Promise.all([
      all || query.buy != null ? await this.getBuyTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.sell != null ? await this.getSellTransactions(userId, query.from, query.to) : Promise.resolve([]),
      all || query.staking != null ? await this.getStakingRewards(userId, query.from, query.to) : Promise.resolve([]),
      all || query.ref != null ? await this.getRefRewards(userId, query.from, query.to) : Promise.resolve([]),
      all || query.lm != null
        ? await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY, query.from, query.to, timeout)
        : Promise.resolve([]),
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
    const cryptoBuys = await this.cryptoBuyService.getUserTransactions(userId, dateFrom, dateTo);
    return cryptoBuys
      .map((c) => [
        {
          type: 'Deposit',
          buyAmount: c.bankTx?.txAmount,
          buyAsset: c.bankTx?.txCurrency,
          sellAmount: null,
          sellAsset: null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: c.bankTx?.iban,
          date: c.outputDate ? this.createRandomDate(c.outputDate, -20, c.amount) : null,
          txid: c.bankTx?.accountServiceRef,
          buyValueInEur: null,
          sellValueInEur: null,
        },
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: c.buy?.deposit ? 'DFI' : c.buy?.asset?.name,
          sellAmount: c.bankTx?.txAmount,
          sellAsset: c.bankTx?.txCurrency,
          fee: c.fee ? c.fee * c.bankTx?.txAmount : null,
          feeAsset: c.fee ? c.bankTx?.txCurrency : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: c.buy.user.address,
          date: c.outputDate ? c.outputDate : null,
          txid: c.txId,
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getSellTransactions(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const cryptoSells = await this.cryptoSellService.getUserTransactions(userId, dateFrom, dateTo);
    return cryptoSells
      .map((c) => [
        {
          type: 'Trade',
          buyAmount: c.outputAmount,
          buyAsset: 'fiat' in c.cryptoInput.route ? c.cryptoInput.route.fiat?.name : null,
          sellAmount: c.cryptoInput.amount,
          sellAsset: c.cryptoInput.asset?.name,
          fee: c.fee ? c.fee * c.cryptoInput.amount : null,
          feeAsset: c.fee ? c.cryptoInput.asset?.name : null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: c.cryptoInput.route.user.address,
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
          sellAsset: 'fiat' in c.cryptoInput.route ? c.cryptoInput.route.fiat?.name : null,
          fee: null,
          feeAsset: null,
          exchange: 'DFX',
          tradeGroup: null,
          comment: c.bankTx?.iban,
          date: c.outputDate ? c.outputDate : null,
          txid: c.bankTx?.txId,
          buyValueInEur: null,
          sellValueInEur: null,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getStakingRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const stakingRewards = await this.stakingRewardService.getUserRewards(userId, dateFrom, dateTo);
    return stakingRewards
      .map((c) => [
        {
          type: 'Staking',
          buyAmount: c.outputAmount,
          buyAsset: c.outputAsset,
          sellAmount: null,
          sellAsset: null,
          fee: c.fee ? c.fee * c.inputAmount : null,
          feeAsset: c.fee ? c.inputAsset : null,
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

  private async getRefRewards(userId: number, dateFrom?: Date, dateTo?: Date): Promise<HistoryDto[]> {
    const refRewards = await this.refRewardService.getUserRewards(userId, dateFrom, dateTo);
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

  private async getDfiTaxRewards(
    userAddress: string,
    interval: string,
    dateFrom?: Date,
    dateTo?: Date,
    timeout?: number,
  ): Promise<HistoryDto[]> {
    const rewards = await this.dfiTaxService.getRewards(userAddress, interval, dateFrom, dateTo, timeout);
    return rewards.map((reward) => ({
      type: 'Mining',
      buyAmount: Util.round(reward.qty, 8),
      // TODO: new col in asset table to differentiate stocks and crypto token
      buyAsset: ['DUSD', 'DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(reward.token)
        ? reward.token
        : `d${reward.token}`,
      sellAmount: null,
      sellAsset: null,
      fee: null,
      feeAsset: null,
      exchange: 'DFX',
      tradeGroup: null,
      comment: `Liquidity Mining ${reward.category} ${reward.pool}`,
      date: new Date(reward.date),
      txid: null,
      buyValueInEur: Util.round(reward.value_open, 8),
      sellValueInEur: null,
    }));
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
}
