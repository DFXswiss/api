import { SepaEntry } from './dto/sepa-entry.dto';
import { SepaFile } from './dto/sepa-file.dto';
import { SepaCdi, SepaAddress, ChargeRecord } from './dto/sepa.dto';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx } from './bank-tx.entity';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/util';

export class SepaParser {
  static parseSepaFile(xmlFile: string): SepaFile {
    return Util.parseXml<{ Document: SepaFile }>(xmlFile).Document;
  }

  static parseBatch(file: SepaFile): Partial<BankTxBatch> {
    const info = file.BkToCstmrStmt.Stmt;
    const identification = info.Id;

    // try to parse the data
    let data: Partial<BankTxBatch> = {};
    try {
      data = {
        sequenceNumber: +info?.ElctrncSeqNb,
        creationDate: new Date(info?.CreDtTm),
        fromDate: new Date(info?.FrToDt?.FrDtTm),
        toDate: new Date(info?.FrToDt?.ToDtTm),
        duplicate: info?.CpyDplctInd,
        iban: info?.Acct?.Id?.IBAN,
        balanceBeforeAmount: +info?.Bal?.[0]?.Amt?.['#text'],
        balanceBeforeCurrency: info?.Bal?.[0]?.Amt?.['@_Ccy'],
        balanceBeforeCdi: info?.Bal?.[0]?.CdtDbtInd,
        balanceAfterAmount: +info?.Bal?.[1]?.Amt?.['#text'],
        balanceAfterCurrency: info?.Bal?.[1]?.Amt?.['@_Ccy'],
        balanceAfterCdi: info?.Bal?.[1]?.CdtDbtInd,
        totalCount: +info?.TxsSummry?.TtlNtries?.NbOfNtries,
        totalAmount: +info?.TxsSummry?.TtlNtries?.TtlNetNtry?.Amt,
        totalCdi: info?.TxsSummry?.TtlNtries?.TtlNetNtry?.CdtDbtInd,
        creditCount: +info?.TxsSummry?.TtlCdtNtries?.NbOfNtries,
        creditAmount: +info?.TxsSummry?.TtlCdtNtries?.Sum,
        debitCount: +info?.TxsSummry?.TtlDbtNtries?.NbOfNtries,
        debitAmount: +info?.TxsSummry?.TtlDbtNtries?.Sum,
      };
    } catch (e) {
      console.error(`Failed to import SEPA batch data for ID ${identification}:`, e);
    }

    return {
      identification,
      ...data,
    };
  }

  static parseEntries(file: SepaFile): Partial<BankTx>[] {
    const entries = Array.isArray(file.BkToCstmrStmt.Stmt.Ntry)
      ? file.BkToCstmrStmt.Stmt.Ntry
      : [file.BkToCstmrStmt.Stmt.Ntry];

    return entries.map((entry) => {
      const accountServiceRef =
        entry?.NtryDtls?.TxDtls?.Refs?.AcctSvcrRef ??
        `CUSTOM/${file.BkToCstmrStmt.Stmt?.Acct?.Id?.IBAN}/${entry.BookgDt.Dt}/${entry.AddtlNtryInf}`;

      let data: Partial<BankTx> = {};
      try {
        data = {
          bookingDate: new Date(entry?.BookgDt?.Dt),
          valueDate: new Date(entry?.ValDt?.Dt),
          txCount: +entry?.NtryDtls?.Btch?.NbOfTxs,
          endToEndId: entry?.NtryDtls?.TxDtls?.Refs?.EndToEndId,
          instructionId: entry?.NtryDtls?.TxDtls?.Refs?.InstrId,
          txId: entry?.NtryDtls?.TxDtls?.Refs?.TxId,
          amount: +entry?.NtryDtls?.TxDtls?.Amt?.['#text'],
          currency: entry?.NtryDtls?.TxDtls?.Amt?.['@_Ccy'],
          creditDebitIndicator: entry?.NtryDtls?.TxDtls?.CdtDbtInd,
          instructedAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt?.['#text'],
          instructedCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt?.['@_Ccy'],
          txAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt?.['#text'],
          txCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt?.['@_Ccy'],
          exchangeSourceCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.SrcCcy,
          exchangeTargetCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.TrgtCcy,
          exchangeRate: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.XchgRate,
          ...this.getTotalCharge(entry?.NtryDtls?.TxDtls?.Chrgs?.Rcrd),
          ...this.getRelatedPartyInfo(entry),
          ...this.getRelatedAgentInfo(entry),
          remittanceInfo: entry?.NtryDtls?.TxDtls?.RmtInf?.Ustrd,
          txInfo: entry?.NtryDtls?.TxDtls?.AddtlTxInf,
        };
      } catch (e) {
        console.error(`Failed to import SEPA entry data for ref ${accountServiceRef}:`, e);
      }

      return {
        accountServiceRef,
        ...data,
      };
    });
  }

  private static getTotalCharge(charges: ChargeRecord | ChargeRecord[] | undefined): {
    chargeAmount: number;
    chargeCurrency: string;
  } {
    if (!charges) return { chargeAmount: 0, chargeCurrency: Config.defaultCurrency };

    charges = Array.isArray(charges) ? charges : [charges];

    const amount = charges.reduce(
      (prev, curr) => prev + (curr.CdtDbtInd === SepaCdi.DEBIT ? +curr.Amt['#text'] : -+curr.Amt['#text']),
      0,
    );
    const currency = [...new Set(charges.map((c) => c.Amt['@_Ccy']))].join(', ');

    return { chargeAmount: Util.round(amount, Config.defaultVolumeDecimal), chargeCurrency: currency };
  }

  private static getRelatedPartyInfo(entry: SepaEntry): Partial<BankTx> {
    const parties = entry?.NtryDtls?.TxDtls?.RltdPties;
    const { party, account, ultimateParty } =
      entry?.NtryDtls?.TxDtls?.CdtDbtInd === SepaCdi.CREDIT
        ? { party: parties?.Dbtr, account: parties?.DbtrAcct, ultimateParty: parties?.UltmtDbtr }
        : { party: parties?.Cdtr, account: parties?.CdtrAcct, ultimateParty: parties?.UltmtCdtr };

    return {
      name: party?.Nm,
      ultimateName: ultimateParty?.Nm,
      ...this.getAddress(party?.PstlAdr),
      iban: account?.Id?.IBAN,
    };
  }

  private static getRelatedAgentInfo(entry: SepaEntry): Partial<BankTx> {
    const agents = entry?.NtryDtls?.TxDtls?.RltdAgts;
    const agent = entry?.NtryDtls?.TxDtls?.CdtDbtInd === SepaCdi.CREDIT ? agents?.DbtrAgt : agents?.CdtrAgt;

    return {
      bic: agent?.FinInstnId?.BICFI,
      clearingSystemId: agent?.FinInstnId?.ClrSysMmbId?.ClrSysId?.Cd,
      memberId: agent?.FinInstnId?.ClrSysMmbId?.MmbId,
      bankName: agent?.FinInstnId?.Nm,
      bankAddressLine1: this.getAddress(agent?.FinInstnId?.PstlAdr)?.addressLine1,
      bankAddressLine2: this.getAddress(agent?.FinInstnId?.PstlAdr)?.addressLine2,
    };
  }

  private static getAddress(address: SepaAddress): Partial<BankTx> {
    return {
      addressLine1:
        (Array.isArray(address?.AdrLine) ? address?.AdrLine[0] : address?.AdrLine) ??
        this.join([address?.StrtNm, address?.BldgNb]),
      addressLine2:
        (Array.isArray(address?.AdrLine) ? address?.AdrLine[1] : undefined) ??
        this.join([address?.PstCd, address?.TwnNm]),
      country: address?.Ctry,
    };
  }

  private static join(array: (string | undefined)[]): string | undefined {
    const join = array.filter((s) => s).join(' ');
    return join ? join : undefined;
  }
}
