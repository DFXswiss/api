import { ConflictException, Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { FiatOutput } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
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

  // Minimum age of a DBIT before it is considered an external chargeback: our own fiat_output
  // payments are imported untyped and only typed once searchOutgoingBankTx (every minute) matches
  // them by remittance reference - a fresh DBIT could still be such an in-flight payment.
  private static readonly EXTERNAL_CHARGEBACK_MATURITY_MINUTES = 60;

  // Finds the single unassigned outgoing bank TX that refunded a failed buy-crypto outside the
  // system (booked directly at the bank, so no fiat_output and no remittance reference exists).
  // Matched conservatively on source account, currency, net-of-charge amount and import order, plus
  // one of two counterparty profiles:
  // - the DBIT carries a counterparty IBAN: it must equal the deposit's sender IBAN;
  // - the DBIT carries none (e.g. Olkypay bank-direct refunds, 'Montant initial : 83,39 ...'): the
  //   remittance text must quote the refunded amount - account/currency/amount alone is too weak
  //   and would also fit IBAN-less bank-fee DBITs on an amount coincidence.
  // In-flight DBITs of our own fiat_output payments are excluded three ways: already linked
  // (fiat_output.bankTxId), same remittance text or end-to-end ID as any fiat_output, and the
  // maturity delay above so the fiat-output matcher claims its own first. Bank TXs already linked
  // as chargeback of any buy-crypto are excluded. Ambiguity yields no match instead of throwing -
  // such cases must stay for manual assignment, auto-matching never guesses (the caller must also
  // discard a TX matching more than one of its candidates).
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
      .leftJoin(FiatOutput, 'linkedFiatOutput', 'linkedFiatOutput.bankTxId = bankTx.id')
      .leftJoin(
        FiatOutput,
        'remittanceFiatOutput',
        `REPLACE(remittanceFiatOutput.remittanceInfo, ' ', '') = REPLACE(bankTx.remittanceInfo, ' ', '')`,
      )
      .leftJoin(FiatOutput, 'endToEndFiatOutput', 'endToEndFiatOutput.endToEndId = bankTx.endToEndId')
      .where('bankTx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.DEBIT })
      .andWhere(
        new Brackets((type) =>
          type
            .where('bankTx.type IS NULL')
            .orWhere('bankTx.type IN (:...unassignedTypes)', { unassignedTypes: BankTxUnassignedTypes }),
        ),
      )
      .andWhere(
        new Brackets((iban) =>
          iban
            .where(`UPPER(REPLACE(bankTx.iban, ' ', '')) = :counterpartyIban`, { counterpartyIban })
            .orWhere('bankTx.iban IS NULL'),
        ),
      )
      .andWhere(`UPPER(REPLACE(bankTx.accountIban, ' ', '')) = :accountIban`, { accountIban })
      .andWhere('UPPER(bankTx.currency) = :currency', { currency })
      .andWhere('ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance', {
        amount: match.amount,
        amountTolerance: 0.005,
      })
      // both sides are import timestamps (created), not booking/value dates: a refund imported
      // before its deposit row (statement backfill, same-batch ordering) stays a manual case
      .andWhere('bankTx.created >= :earliestDate', { earliestDate: match.earliestDate })
      .andWhere('bankTx.created <= :maturedDate', {
        maturedDate: Util.minutesBefore(BankTxOutgoingMatchService.EXTERNAL_CHARGEBACK_MATURITY_MINUTES),
      })
      .andWhere('chargebackOf.id IS NULL')
      .andWhere('linkedFiatOutput.id IS NULL')
      .andWhere('remittanceFiatOutput.id IS NULL')
      .andWhere('endToEndFiatOutput.id IS NULL')
      .orderBy('bankTx.id', 'DESC')
      .take(5)
      .getMany();

    const plausible = matches.filter(
      (tx) => tx.iban || BankTxOutgoingMatchService.remittanceQuotesAmount(tx.remittanceInfo, match.amount),
    );
    return plausible.length === 1 ? plausible[0] : undefined;
  }

  // Whether the remittance text quotes the given amount ('83.39'/'83,39', integers also plain
  // '500'), delimited by non-digits so '1500'/'83,391' never count as '500'/'83,39'. Conservative
  // by design: a miss only leaves the case for manual assignment.
  private static remittanceQuotesAmount(remittanceInfo: string | undefined, amount: number): boolean {
    if (!remittanceInfo) return false;
    const compact = remittanceInfo.replace(/\s/g, '');
    const rounded = Util.round(amount, 2);
    const variants = new Set([
      `${rounded}`,
      rounded.toFixed(2),
      `${rounded}`.replace('.', ','),
      rounded.toFixed(2).replace('.', ','),
    ]);
    return [...variants].some((variant) =>
      new RegExp(`(?<![\\d.,])${variant.replace('.', '\\.')}(?![\\d])`).test(compact),
    );
  }
}
