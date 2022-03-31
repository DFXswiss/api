import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType } from './bank-tx.entity';

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
      if (!referencedBankTx) throw new NotFoundException('Referenced bankTx not found');
      const duplicateReference = await this.bankTxRepo.findOne({ nextRepeatBankTx: { id: dto.nextRepeatBankTxId } });
      if (duplicateReference) throw new ConflictException('nextRepeat bankTx already used');
      bankTx.nextRepeatBankTx = referencedBankTx;
    }
    if (dto.returnBankTxId) {
      const referencedBankTx = await this.bankTxRepo.findOne({ id: dto.returnBankTxId });
      if (!referencedBankTx) throw new NotFoundException('Referenced bankTx not found');
      const duplicateReference = await this.bankTxRepo.findOne({ returnBankTx: { id: dto.returnBankTxId } });
      if (duplicateReference) throw new ConflictException('Return bankTx already used');
      bankTx.returnBankTx = referencedBankTx;
    }

    return await this.bankTxRepo.save({ ...bankTx });
  }

  async getUnmapped(): Promise<BankTx[]> {
    const unmappedEntries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .addSelect('cryptoSell.id')
      .addSelect('cryptoBuy.id')
      .addSelect('previousRepeatBankTx.id')
      .addSelect('returnSourceBankTx.id')
      .addSelect('returnBankTx.id')
      .addSelect('nextRepeatBankTx.id')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .leftJoin('bankTx.nextRepeatBankTx', 'nextRepeatBankTx')
      .leftJoin('bankTx.returnSourceBankTx', 'returnSourceBankTx')
      .leftJoin('bankTx.returnBankTx', 'returnBankTx')
      .where('returnBankTx.id IS NULL')
      .andWhere('returnSourceBankTx.id IS NULL')
      .andWhere('nextRepeatBankTx.id IS NULL')
      .andWhere('previousRepeatBankTx.id IS NULL')
      .andWhere('cryptoSell.id IS NULL')
      .andWhere('cryptoBuy.id IS NULL')
      .andWhere("(bankTx.name NOT LIKE '%DFX AG%' OR bankTx.name NOT LIKE '%Payward Ltd.%')")
      .getMany();

    return unmappedEntries.map((e) => ({ ...e, type: BankTxType.UNKNOWN }));
  }

  async getAllEntriesWithMapping(): Promise<BankTx[]> {
    const entries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .addSelect('cryptoSell.id')
      .addSelect('cryptoBuy.id')
      .addSelect('previousRepeatBankTx.id')
      .addSelect('returnSourceBankTx.id')
      .addSelect('returnBankTx.id')
      .addSelect('nextRepeatBankTx.id')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.returnSourceBankTx', 'returnSourceBankTx')
      .leftJoin('bankTx.returnBankTx', 'returnBankTx')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .leftJoin('bankTx.nextRepeatBankTx', 'nextRepeatBankTx')
      .getMany();

    return entries.map((e) =>
      !e.returnBankTx && !e.returnSourceBankTx
        ? !e.nextRepeatBankTx && !e.previousRepeatBankTx
          ? !e.cryptoSell
            ? !e.cryptoBuy
              ? !e.name?.includes('DFX AG') && !e.name?.includes('Payward Ltd.')
                ? { ...e, type: BankTxType.UNKNOWN }
                : { ...e, type: BankTxType.INTERNAL }
              : { ...e, type: BankTxType.CRYPTO_BUY }
            : { ...e, type: BankTxType.CRYPTO_SELL }
          : { ...e, type: BankTxType.REPEAT }
        : { ...e, type: BankTxType.RETURN },
    );
  }

  // --- HELPER METHODS --- //
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
