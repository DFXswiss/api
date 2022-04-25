import { Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType, RawBankTx, TypedBankTx } from './bank-tx.entity';
import { BuyCryptoService } from '../buy-crypto/buy-crypto.service';

@Injectable()
export class BankTxService {
  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly mailService: MailService,
  ) {}

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    let bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!bankTx) throw new NotFoundException('BankTx not found');
    // if (bankTx.type && bankTx.type != BankTxType.UNKNOWN) throw new ConflictException('BankTx Type already set');

    bankTx.type = dto.type;

    // TODO create buy_crypto
    if (bankTx.type === BankTxType.CRYPTO_BUY) await this.buyCryptoService.create(bankTxId, dto.buyId);

    bankTx = await this.bankTxRepo.save(bankTx);

    return bankTx;
  }

  async getUntyped(minId = 1, startDate: Date = new Date(0)): Promise<BankTx[]> {
    return await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.returnBankTx', 'returnBankTx')
      .leftJoin('bankTx.returnSourceBankTx', 'returnSourceBankTx')
      .leftJoin('bankTx.nextRepeatBankTx', 'nextRepeatBankTx')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .where('cryptoSell.id IS NULL')
      .andWhere('cryptoBuy.id IS NULL')
      .andWhere('returnBankTx.id IS NULL')
      .andWhere('returnSourceBankTx.id IS NULL')
      .andWhere('nextRepeatBankTx.id IS NULL')
      .andWhere('previousRepeatBankTx.id IS NULL')
      .andWhere("(bankTx.name NOT LIKE '%DFX AG%' AND bankTx.name NOT LIKE '%Payward Ltd.%')")
      .andWhere('bankTx.id >= :minId', { minId })
      .andWhere('bankTx.updated >= :startDate', { startDate })
      .getMany();
  }

  async getWithType(minId = 1, startDate: Date = new Date(0)): Promise<TypedBankTx[]> {
    const entries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx.id', 'id')
      .addSelect('bankTx.name', 'name')
      .addSelect('cryptoSell.id', 'cryptoSellId')
      .addSelect('cryptoBuy.id', 'cryptoBuyId')
      .addSelect('returnBankTx.id', 'returnBankTxId')
      .addSelect('returnSourceBankTx.id', 'returnSourceBankTxId')
      .addSelect('nextRepeatBankTx.id', 'nextRepeatBankTxId')
      .addSelect('previousRepeatBankTx.id', 'previousRepeatBankTxId')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.returnBankTx', 'returnBankTx')
      .leftJoin('bankTx.returnSourceBankTx', 'returnSourceBankTx')
      .leftJoin('bankTx.nextRepeatBankTx', 'nextRepeatBankTx')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .where('bankTx.id >= :minId', { minId })
      .andWhere('bankTx.updated >= :startDate', { startDate })
      .getRawMany<RawBankTx>();

    return entries.map((e) => ({ ...e, type: this.getBankTxType(e) }));
  }

  // --- HELPER METHODS --- //
  private getBankTxType(tx: RawBankTx): BankTxType {
    if (tx.returnBankTxId || tx.returnSourceBankTxId) return BankTxType.RETURN;
    if (tx.cryptoSellId) return BankTxType.CRYPTO_SELL;
    if (tx.cryptoBuyId) return BankTxType.CRYPTO_BUY;
    if (tx.nextRepeatBankTxId || tx.previousRepeatBankTxId) return BankTxType.REPEAT;
    if (tx.name?.includes('DFX AG') || tx.name?.includes('Payward Ltd.')) return BankTxType.INTERNAL;

    return BankTxType.UNKNOWN;
  }

  private async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // parse the file
    const batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile));

    // store the batch
    await this.bankTxBatchRepo.save(batch);

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .find({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}:`;
      console.log(message, duplicates);
      this.mailService.sendErrorMail('SEPA Error', [message + ` ${duplicates.join(', ')}`]);
    }

    // store the entries
    const newTxs = txList
      .filter((i) => !duplicates.includes(i.accountServiceRef))
      .map((tx) => ({ batch: batch, ...tx }));
    await this.bankTxRepo.saveMany(newTxs);

    batch.transactions = txList;
    return batch;
  }
}
