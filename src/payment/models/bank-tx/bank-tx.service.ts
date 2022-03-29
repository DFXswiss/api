import { Injectable, NotFoundException } from '@nestjs/common';
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

    return await this.bankTxRepo.save({ ...bankTx, ...dto });
  }

  async updateProblemEntries(): Promise<void> {
    const wrongEntries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .leftJoinAndSelect('bankTx.cryptoSell', 'cryptoSell')
      .leftJoinAndSelect('bankTx.cryptoBuy', 'cryptoBuy')
      .where(
        'bankTx.txType IS NULL AND (cryptoSell.id IS NOT NULL OR cryptoBuy.id IS NOT NULL OR bankTx.name LIKE :dfx OR bankTx.name LIKE :payward)',
        { dfx: '%DFX AG%', payward: '%Payward Ltd.%' },
      )
      .getMany();

    for (const entry of wrongEntries) {
      await this.update(entry.id, {
        txType: !entry.cryptoBuy
          ? !entry.cryptoSell
            ? BankTxType.INTERNAL
            : BankTxType.CRYPTO_SELL
          : BankTxType.CRYPTO_BUY,
      });
    }
  }

  async getProblems(): Promise<BankTx[]> {
    return await this.bankTxRepo.find({ where: { txType: null } });
  }

  async get(txType: BankTxType): Promise<BankTx[]> {
    return await this.bankTxRepo.find({ where: { txType } });
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
