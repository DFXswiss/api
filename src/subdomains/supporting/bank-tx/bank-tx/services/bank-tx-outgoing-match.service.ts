import { ConflictException, Injectable } from '@nestjs/common';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Brackets } from 'typeorm';
import { BankTx, BankTxIndicator, BankTxUnassignedTypes } from '../entities/bank-tx.entity';
import { BankTxRepository } from '../repositories/bank-tx.repository';

export interface OutgoingBankTxMatch {
  remittanceInfo?: string;
  endToEndId?: string;
  accountIban?: string;
  amount?: number;
  currency?: string;
  earliestDate?: Date;
}

export interface ExternalChargebackBankTxMatch {
  counterpartyIban?: string;
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
      // Net of any bank charge deducted from the booked debit (0 for every non-charged bank/entry, so
      // this is a no-op everywhere except a charged Bank Frick FOREIGN payout).
      .andWhere('ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance', {
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

  // Finds the single unassigned outgoing bank TX that refunded a failed buy-crypto outside the
  // system (booked directly at the bank, so no fiat_output and no remittance reference exists).
  // Matched conservatively on counterparty IBAN, source account, currency, net amount and booking
  // date; bank TXs already linked as chargeback of any buy-crypto are excluded. Ambiguity yields no
  // match instead of throwing - such cases must stay for manual assignment, auto-matching never guesses.
  async getUniqueExternalChargebackBankTx(match: ExternalChargebackBankTxMatch): Promise<BankTx | undefined> {
    const counterpartyIban = match.counterpartyIban?.replace(/\s/g, '').toUpperCase();
    const accountIban = match.accountIban?.replace(/\s/g, '').toUpperCase();
    const currency = match.currency?.trim().toUpperCase();
    if (
      !counterpartyIban ||
      !accountIban ||
      !currency ||
      !Number.isFinite(match.amount) ||
      match.amount <= 0 ||
      !(match.earliestDate instanceof Date) ||
      Number.isNaN(match.earliestDate.getTime())
    )
      return undefined;

    const matches = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      // the consumer types the matched TX, which updates its transaction row - load it along
      .leftJoinAndSelect('bankTx.transaction', 'transaction')
      .leftJoin(BuyCrypto, 'chargebackOf', 'chargebackOf.chargebackBankTxId = bankTx.id')
      .where('bankTx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.DEBIT })
      .andWhere(
        new Brackets((type) =>
          type
            .where('bankTx.type IS NULL')
            .orWhere('bankTx.type IN (:...unassignedTypes)', { unassignedTypes: BankTxUnassignedTypes }),
        ),
      )
      .andWhere(`UPPER(REPLACE(bankTx.iban, ' ', '')) = :counterpartyIban`, { counterpartyIban })
      .andWhere(`UPPER(REPLACE(bankTx.accountIban, ' ', '')) = :accountIban`, { accountIban })
      .andWhere('UPPER(bankTx.currency) = :currency', { currency })
      .andWhere('ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance', {
        amount: match.amount,
        amountTolerance: 0.005,
      })
      .andWhere('bankTx.created >= :earliestDate', { earliestDate: match.earliestDate })
      .andWhere('chargebackOf.id IS NULL')
      .orderBy('bankTx.id', 'DESC')
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : undefined;
  }
}
