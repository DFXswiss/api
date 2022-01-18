import { Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from 'src/user/models/buy/buy.service';
import { Readable } from 'stream';
import { In } from 'typeorm';
import { AmlCheck } from '../crypto-buy/crypto-buy.entity';
import { CryptoBuyRepository } from '../crypto-buy/crypto-buy.repository';
import { TransactionDto } from './dto/transaction.dto';

@Injectable()
export class TransactionService {
  constructor(private readonly buyService: BuyService, private readonly cryptoBuyRepo: CryptoBuyRepository) {}

  async getTransactions(userId: number): Promise<TransactionDto[]> {
    const tx = await Promise.all([
      this.getBuyTransactions(userId),
      // this.getSellTransactions(userId)
    ]).then((tx) => tx.reduce((prev, curr) => prev.concat(curr), []));

    return tx.sort((tx1, tx2) => ((tx1.date?.getTime() ?? 0) - (tx2.date?.getTime() ?? 0) > 0 ? -1 : 1));
  }

  async getBuyTransactions(userId: number): Promise<TransactionDto[]> {
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
          date: c.outputDate ? this.fakeRandomDate(c.outputDate, -20, c.amount) : null,
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

  // async getSellTransactions(userId: number): Promise<TransactionDto[]> {
  //   const sells = await this.buyService.getUserBuys(userId);
  //   const cryptoSells = await this.cryptoBuyRepo.find({
  //     where: { buy: { id: In(sells.map((b) => b.id)) }, amlCheck: AmlCheck.PASS },
  //     relations: ['bankTx', 'buy', 'buy.user'],
  //   });

  //   return cryptoSells
  //     .map((c) => [
  //       {
  //         type: 'Deposit',
  //         buyAmount: c.amount,
  //         buyAsset: c.buy?.asset.name,
  //         sellAmount: null,
  //         sellAsset: null,
  //         fee: null,
  //         feeAsset: null,
  //         exchange: 'DFX',
  //         tradeGroup: null,
  //         comment: c.bankTx?.iban,
  //         date: c.outputDate ? this.fakeRandomDate(c.outputDate, -20, c.amount) : null,
  //         txid: c.bankTx?.accountServiceRef,
  //         buyValueInEur: null,
  //         sellValueInEur: null,
  //       },
  //       {
  //         type: 'Trade',
  //         buyAmount: c.outputAmount,
  //         buyAsset: c.buy.asset.name,
  //         sellAmount: c.amount,
  //         sellAsset: c.fiat?.name,
  //         fee: c.fee ? c.fee * c.amount : null,
  //         feeAsset: c.fee ? c.fiat?.name : null,
  //         exchange: 'DFX',
  //         tradeGroup: null,
  //         comment: c.buy.user.address,
  //         date: c.outputDate ? c.outputDate : null,
  //         txid: c.txId,
  //         buyValueInEur: null,
  //         sellValueInEur: null,
  //       },
  //       {
  //         type: 'Withdrawal',
  //         buyAmount: null,
  //         buyAsset: null,
  //         sellAmount: c.amount,
  //         sellAsset: c.fiat?.name,
  //         fee: c.fee ? c.fee * c.amount : null,
  //         feeAsset: c.fee ? c.fiat?.name : null,
  //         exchange: 'DFX',
  //         tradeGroup: null,
  //         comment: c.buy.user.address,
  //         date: c.outputDate ? this.fakeRandomDate(c.outputDate, 20, c.amount) : null,
  //         txid: c.txId,
  //         buyValueInEur: null,
  //         sellValueInEur: null,
  //       },
  //     ])
  //     .reduce((prev, curr) => prev.concat(curr), []);
  // }

  async getTransactionCsv(userId: number): Promise<Readable> {
    const tx = await this.getTransactions(userId);
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return Readable.from([this.toCsv(tx)]);
  }

  // --- HELPER METHODS --- //
  private toCsv(list: any[], separator = ','): string {
    const headers = Object.keys(list[0]).join(separator);
    const values = list.map((t) => Object.values(t).join(separator));
    return [headers].concat(values).join('\n');
  }

  private fakeRandomDate(outputDate: Date, offset: number, amount: number): Date {
    return new Date(outputDate.getTime() + (offset - (amount % 10)) * 60 * 1000);
  }
}
