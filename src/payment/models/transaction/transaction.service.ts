import { Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from 'src/user/models/buy/buy.service';
import { Readable } from 'stream';
import { In } from 'typeorm';
import { AmlCheck } from '../crypto-buy/crypto-buy.entity';
import { CryptoBuyRepository } from '../crypto-buy/crypto-buy.repository';
import { TransactionDto } from './dto/transaction.dto';
import { HttpService } from 'src/shared/services/http.service';
import { Reward } from './dto/reward';
import { Util } from 'src/shared/util';

@Injectable()
export class TransactionService {
  constructor(
    private readonly buyService: BuyService,
    private readonly cryptoBuyRepo: CryptoBuyRepository,
    private readonly http: HttpService,
  ) {}

  async getTransactions(userId: number, userAddress: string): Promise<TransactionDto[]> {
    const tx = await Promise.all([
      await this.getBuyTransactions(userId),
      // this.getSellTransactions(userId),
      // await this.getDFITaxRewards(userAddress),
    ]).then((tx) => tx.reduce((prev, curr) => prev.concat(curr), []));

    return tx.sort((tx1, tx2) => ((tx1.date?.getTime() ?? 0) - (tx2.date?.getTime() ?? 0) > 0 ? -1 : 1));
  }

  async getTransactionCsv(userId: number, userAddress: string): Promise<Readable> {
    const tx = await this.getTransactions(userId, userAddress);
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return Readable.from([this.toCsv(tx)]);
  }

  // --- HELPER METHODS --- //
  private async getBuyTransactions(userId: number): Promise<TransactionDto[]> {
    const buys = await this.buyService.getUserBuys(userId);
    const cryptoBuys = await this.cryptoBuyRepo.find({
      where: { buy: { id: In(buys.map((b) => b.id)) }, amlCheck: AmlCheck.PASS },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

    return cryptoBuys
      .map((c) => [
        {
          type: 'Deposit',
          buyAmount: c.amount,
          buyAsset: c.fiat?.name,
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
          buyAsset: c.buy.asset.name,
          sellAmount: c.amount,
          sellAsset: c.fiat?.name,
          fee: c.fee ? c.fee * c.amount : null,
          feeAsset: c.fee ? c.fiat?.name : null,
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

  // private async getSellTransactions(userId: number): Promise<TransactionDto[]> {
  //   const sells = await this.sellService.getUserSells(userId);
  //   const cryptoSells = await this.cryptoSellRepo.find({
  //     where: { cryptoInput: { route: { id: In(sells.map((b) => b.id)) }}, amlCheck: AmlCheck.PASS },
  //     relations: ['cryptoInput', 'cryptoInput.route', 'cryptoInput.route.user', 'bankTx'],
  //   });

  //   return cryptoSells
  //     .map((c) => [
  //       {
  //         type: 'Trade',
  //         buyAmount: c.outputAmount,
  //         buyAsset: c.cryptoInput.route.fiat?.name,
  //         sellAmount: c.cryptoInput.amount,
  //         sellAsset: c.cryptoInput.asset?.name,
  //         fee: c.fee ? c.fee * c.cryptoInput.amount : null,
  //         feeAsset: c.fee ? c.cryptoInput.asset?.name : null,
  //         exchange: 'DFX',
  //         tradeGroup: null,
  //         comment: c.cryptoInput.route.user.address,
  //         date: c.cryptoInput.created
  //         txid: c.cryptoInput.inTxId,
  //         buyValueInEur: null,
  //         sellValueInEur: null,
  //       },
  //       {
  //         type: 'Withdrawal',
  //         buyAmount: null,
  //         buyAsset: null,
  //         sellAmount: c.outputAmount,
  //         sellAsset: c.cryptoInput.route.fiat?.name,
  //         fee: c.fee ? c.fee * c.cryptoInput.amount : null,
  //         feeAsset: c.fee ? c.cryptoInput.asset?.name : null,
  //         exchange: 'DFX',
  //         tradeGroup: null,
  //         comment: c.bankTx.iban,
  //         date: c.outputDate ? c.outputDate : null,
  //         txid: c.bankTx.txid,
  //         buyValueInEur: null,
  //         sellValueInEur: null,
  //       },
  //     ])
  //     .reduce((prev, curr) => prev.concat(curr), []);
  // }

  private async getDFITaxRewards(userAddress: string): Promise<TransactionDto[]> {
    const rewards = await this.getRewards(userAddress);
    return rewards.map((reward) => ({
      type: 'Mining',
      buyAmount: Util.round(reward.detail.qty, 8),
      // TODO: new col in asset table to differentiate stocks and crypto token
      buyAsset: ['DUSD', 'DFI', 'BTC', 'ETH', 'BCH', 'DOGE', 'LTC', 'USDC', 'USDT'].includes(reward.detail.token)
        ? reward.detail.token
        : `d${reward.detail.token}`,
      sellAmount: null,
      sellAsset: null,
      fee: null,
      feeAsset: null,
      exchange: 'DFX',
      tradeGroup: null,
      comment: `Liquidity Mining ${reward.category} ${reward.detail.pool}`,
      date: new Date(reward.date),
      txid: null,
      buyValueInEur: Util.round(reward.value, 8),
      sellValueInEur: null,
    }));
  }

  private toCsv(list: any[], separator = ','): string {
    const headers = Object.keys(list[0]).join(separator);
    const values = list.map((t) => Object.values(t).join(separator));
    return [headers].concat(values).join('\n');
  }

  private createRandomDate(outputDate: Date, offset: number, amount: number): Date {
    return new Date(outputDate.getTime() + (offset - (amount % 10)) * 60 * 1000);
  }

  private async getRewards(userAddress: string): Promise<Reward[]> {
    const baseUrl = 'https://api.dfi.tax/v01/rwd';
    const url = `${baseUrl}/${userAddress}/d/true/EUR`;
    return await this.http.get<Reward[]>(url);
  }
}
