import { Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from 'src/payment/models/buy/buy.service';
import { Readable } from 'stream';
import { Between, In } from 'typeorm';
import { AmlCheck } from '../crypto-buy/crypto-buy.entity';
import { CryptoBuyRepository } from '../crypto-buy/crypto-buy.repository';
import { HistoryDto } from './dto/history.dto';
import { Util } from 'src/shared/util';
import { CryptoSellRepository } from '../crypto-sell/crypto-sell.repository';
import { SellService } from '../sell/sell.service';
import { RouteType } from '../route/deposit-route.entity';
import { DfiTaxInterval, DfiTaxService } from 'src/shared/services/dfi-tax.service';
import { StakingRewardService } from '../staking-reward/staking-reward.service';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { RefRewardService } from '../ref-reward/ref-reward.service';

@Injectable()
export class HistoryService {
  constructor(
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly cryptoBuyRepo: CryptoBuyRepository,
    private readonly cryptoSellRepo: CryptoSellRepository,
    private readonly stakingRewardService: StakingRewardService,
    private readonly refRewardService: RefRewardService,
    private readonly dfiTaxService: DfiTaxService,
  ) {}

  async getHistory(
    userId: number,
    userAddress: string,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
    buy: boolean = false,
    sell: boolean = false,
    staking: boolean = false,
    ref: boolean = false,
    lm: boolean = false,
  ): Promise<HistoryDto[]> {
    let buyTransaction;
    let sellTransaction;
    let stakingReward;
    let refReward;
    // let lmReward;

    if (buy) buyTransaction = await this.getBuyTransactions(userId, dateFrom, dateTo);
    if (sell) sellTransaction = await this.getSellTransactions(userId, dateFrom, dateTo);
    if (staking) stakingReward = await this.getStakingRewards(userId, dateFrom, dateTo);
    if (ref) refReward = await this.getRefRewards(userId, dateFrom, dateTo);
    // if (lm) lmReward = await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY);

    const tx =
      buy || sell || staking || ref || lm
        ? await Promise.all([
            buyTransaction,
            sellTransaction,
            stakingReward,
            refReward,
            //lm ? await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY) : null,
          ]).then((tx) => tx.reduce((prev, curr) => prev.concat(curr), []))
        : await Promise.all([
            await this.getBuyTransactions(userId, dateFrom, dateTo),
            await this.getSellTransactions(userId, dateFrom, dateTo),
            await this.getStakingRewards(userId, dateFrom, dateTo),
            await this.getRefRewards(userId, dateFrom, dateTo),
            //lm ? await this.getDfiTaxRewards(userAddress, DfiTaxInterval.DAY) : null,
          ]).then((tx) => tx.reduce((prev, curr) => prev.concat(curr), []));

    return tx.sort((tx1, tx2) => (Util.secondsDiff(tx1.date, tx2.date) < 0 ? -1 : 1));
  }

  async getHistoryCsv(userId: number, userAddress: string): Promise<Readable> {
    const tx = await this.getHistory(userId, userAddress);
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return Readable.from([this.toCsv(tx)]);
  }

  // --- HELPER METHODS --- //
  private async getBuyTransactions(
    userId: number,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<HistoryDto[]> {
    const buys = await this.buyService.getUserBuys(userId);
    const cryptoBuys = await this.cryptoBuyRepo.find({
      where: { buy: { id: In(buys.map((b) => b.id)) }, amlCheck: AmlCheck.PASS, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

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

  private async getSellTransactions(
    userId: number,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<HistoryDto[]> {
    const sells = await this.sellService.getUserSells(userId);
    const cryptoSells = await this.cryptoSellRepo.find({
      where: {
        cryptoInput: { route: { id: In(sells.map((b) => b.id)), type: RouteType.SELL } },
        amlCheck: AmlCheck.PASS,
        outputDate: Between(dateFrom, dateTo),
      },
      relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'bankTx'],
    });

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
          fee: c.fee ? c.fee * c.cryptoInput.amount : null,
          feeAsset: c.fee ? c.cryptoInput.asset?.name : null,
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

  private async getStakingRewards(
    userId: number,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<HistoryDto[]> {
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

  private async getRefRewards(
    userId: number,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<HistoryDto[]> {
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

  private async getDfiTaxRewards(userAddress: string, interval: string): Promise<HistoryDto[]> {
    const rewards = await this.dfiTaxService.getRewards(userAddress, interval);
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
