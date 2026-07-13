import { ConflictException, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { BankTx, BankTxIndicator } from '../entities/bank-tx.entity';
import { BankTxRepository } from '../repositories/bank-tx.repository';

export interface OutgoingBankTxMatch {
  remittanceInfo?: string;
  endToEndId?: string;
  accountIban?: string;
  amount?: number;
  currency?: string;
  earliestDate?: Date;
}

@Injectable()
export class BankTxOutgoingMatchService {
  constructor(private readonly bankTxRepo: BankTxRepository) {}

  async getUniqueOutgoingBankTx(match: OutgoingBankTxMatch): Promise<BankTx> {
    const remittanceInfo = match.remittanceInfo?.trim();
    const endToEndId = match.endToEndId?.trim();
    const accountIban = match.accountIban?.replace(/\s/g, '').toUpperCase();
    const currency = match.currency?.trim().toUpperCase();
    if (
      (!remittanceInfo && !endToEndId) ||
      !accountIban ||
      !currency ||
      !Number.isFinite(match.amount) ||
      match.amount <= 0 ||
      !(match.earliestDate instanceof Date) ||
      Number.isNaN(match.earliestDate.getTime())
    )
      return undefined;

    const query = this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .leftJoinAndSelect('bankTx.transaction', 'transaction')
      .where('bankTx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.DEBIT })
      .andWhere(`UPPER(REPLACE(bankTx.accountIban, ' ', '')) = :accountIban`, { accountIban })
      .andWhere('UPPER(bankTx.currency) = :currency', { currency })
      .andWhere('ABS(bankTx.amount - :amount) < :amountTolerance', {
        amount: match.amount,
        amountTolerance: 0.005,
      })
      .andWhere('bankTx.created >= :earliestDate', { earliestDate: match.earliestDate })
      .orderBy('bankTx.id', 'DESC')
      .take(2);

    query.andWhere(
      new Brackets((references) => {
        if (remittanceInfo)
          references.where(`REPLACE(bankTx.remittanceInfo, ' ', '') = :remittanceInfo`, {
            remittanceInfo: remittanceInfo.replace(/ /g, ''),
          });
        if (endToEndId) {
          if (remittanceInfo) references.orWhere('bankTx.endToEndId = :endToEndId', { endToEndId });
          else references.where('bankTx.endToEndId = :endToEndId', { endToEndId });
        }
      }),
    );

    const matches = await query.getMany();
    if (matches.length > 1) throw new ConflictException('Ambiguous outgoing bank transaction match');
    return matches[0];
  }
}
