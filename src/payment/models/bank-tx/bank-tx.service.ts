import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType, TypedBankTx, UntypedBankTx } from './bank-tx.entity';

@Injectable()
export class BankTxService {
  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    private readonly mailService: MailService,
  ) {}

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!bankTx) throw new NotFoundException('BankTx not found');

    if (dto.nextRepeatBankTxId) {
      const referencedBankTx = await this.bankTxRepo.findOne({ id: dto.nextRepeatBankTxId });
      if (!referencedBankTx) throw new NotFoundException('Repeat bankTx not found');

      const duplicateReference = await this.bankTxRepo.findOne({ nextRepeatBankTx: { id: dto.nextRepeatBankTxId } });
      if (duplicateReference) throw new ConflictException('Repeat bankTx already used');

      bankTx.nextRepeatBankTx = referencedBankTx;
    }

    if (dto.returnBankTxId) {
      const referencedBankTx = await this.bankTxRepo.findOne({ id: dto.returnBankTxId });
      if (!referencedBankTx) throw new NotFoundException('Return bankTx not found');

      const duplicateReference = await this.bankTxRepo.findOne({ returnBankTx: { id: dto.returnBankTxId } });
      if (duplicateReference) throw new ConflictException('Return bankTx already used');

      bankTx.returnBankTx = referencedBankTx;
    }

    return await this.bankTxRepo.save(bankTx);
  }

  async getUntyped(minId = 1, startDate: Date = new Date(0)): Promise<UntypedBankTx[]> {
    const unmappedEntries = await this.bankTxRepo
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

    return unmappedEntries.map((e) => ({ ...e, type: BankTxType.UNKNOWN }));
  }

  async getWithType(minId = 1, startDate: Date = new Date(0)): Promise<TypedBankTx[]> {
    const entries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx.id', 'id')
      .addSelect('bankTx.name', 'name')
      .addSelect('cryptoSell.id', 'cryptoSell')
      .addSelect('cryptoBuy.id', 'cryptoBuy')
      .addSelect('returnBankTx.id', 'returnBankTx')
      .addSelect('returnSourceBankTx.id', 'returnSourceBankTx')
      .addSelect('nextRepeatBankTx.id', 'nextRepeatBankTx')
      .addSelect('previousRepeatBankTx.id', 'previousRepeatBankTx')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.returnBankTx', 'returnBankTx')
      .leftJoin('bankTx.returnSourceBankTx', 'returnSourceBankTx')
      .leftJoin('bankTx.nextRepeatBankTx', 'nextRepeatBankTx')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .where('bankTx.id >= :minId', { minId })
      .andWhere('bankTx.updated >= :startDate', { startDate })
      .getRawMany();

    return entries.map((e) => ({ ...e, type: this.getBankTxType(e) }));
  }

  // --- HELPER METHODS --- //
  private getBankTxType(tx: BankTx): BankTxType {
    if (tx.returnBankTx || tx.returnSourceBankTx) return BankTxType.RETURN;
    if (tx.cryptoSell) return BankTxType.CRYPTO_SELL;
    if (tx.cryptoBuy) return BankTxType.CRYPTO_BUY;
    if (tx.nextRepeatBankTx || tx.previousRepeatBankTx) return BankTxType.REPEAT;
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
