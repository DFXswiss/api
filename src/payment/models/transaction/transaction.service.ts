import { Injectable, NotFoundException } from '@nestjs/common';
import { NotFoundError } from 'rxjs';
import { BuyService } from 'src/user/models/buy/buy.service';
import { Readable } from 'stream';
import { In } from 'typeorm';
import { AmlCheck } from '../crypto-buy/crypto-buy.entity';
import { CryptoBuyRepository } from '../crypto-buy/crypto-buy.repository';
import { TransactionDto, TransactionType } from './dto/transaction.dto';

@Injectable()
export class TransactionService {
  constructor(private readonly buyService: BuyService, private readonly cryptoBuyRepo: CryptoBuyRepository) {}

  async getTransactions(userId: number): Promise<TransactionDto[]> {
    const buys = await this.buyService.getAllBuy(userId);
    const cryptoBuys = await this.cryptoBuyRepo.find({
      where: { buy: { id: In(buys.map((b) => b.id)) }, amlCheck: AmlCheck.PASS },
      relations: ['bankTx', 'buy', 'buy.user'],
    });

    return cryptoBuys.map((c) => ({
      type: TransactionType.FIAT_TO_CRYPTO,
      inputId: c.bankTx.accountServiceRef,
      inputDate: c.inputDate,
      inputAmount: c.amount,
      inputAsset: c.fiat?.name,
      inputAddress: c.bankTx.iban,

      outputAmount: c.outputAmount,
      outputAsset: c.buy.asset.name,
      outputId: c.txId,
      outputDate: c.outputDate,
      outputAddress: c.buy.user.address,

      name: c.name,
      fee: c.fee,
      notificationMail: c.recipientMail,
    }));
  }

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
}
