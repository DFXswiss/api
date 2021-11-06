import { SepaEntry } from './dto/sepa-entry.dto';
import { SepaFile } from './dto/sepa-file.dto';
import { SepaCdi, SepaAddress } from './dto/sepa.dto';
import { FiatInputBatch } from './fiat-input-batch.entity';
import { FiatInput } from './fiat-input.entity';
import * as XmlParser from 'fast-xml-parser';

export class SepaParser {
  static parseSepaFile(xmlFile: string): SepaFile {
    const validationResult = XmlParser.validate(xmlFile);
    if (validationResult !== true) {
      throw validationResult;
    }

    return XmlParser.parse(xmlFile, { ignoreAttributes: false }).Document;
  }

  static parseBatch(file: SepaFile): Partial<FiatInputBatch> {
    const info = file.BkToCstmrStmt.Stmt;
    const identification = info.Id;

    // try to parse the data
    let data: Partial<FiatInputBatch> = {};
    try {
      data = {
        sequenceNumber: +info?.ElctrncSeqNb,
        creationDate: new Date(info?.CreDtTm),
        fromDate: new Date(info?.FrToDt?.FrDtTm),
        toDate: new Date(info?.FrToDt?.ToDtTm),
        duplicate: info?.CpyDplctInd,
        iban: info?.Acct?.Id?.IBAN,
        balanceBeforeAmount: +info?.Bal[0]?.Amt['#text'],
        balanceBeforeCurrency: info?.Bal[0]?.Amt['@_Ccy'],
        balanceBeforeCdi: info?.Bal[0]?.CdtDbtInd,
        balanceAfterAmount: +info?.Bal[1]?.Amt['#text'],
        balanceAfterCurrency: info?.Bal[1]?.Amt['@_Ccy'],
        balanceAfterCdi: info?.Bal[1]?.CdtDbtInd,
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

  static parseEntries(file: SepaFile, batch: FiatInputBatch): Partial<FiatInput>[] {
    return file.BkToCstmrStmt.Stmt.Ntry.map((entry) => {
      const accountServiceRef = entry.NtryDtls.TxDtls.Refs.AcctSvcrRef;

      let data: Partial<FiatInput> = {};
      try {
        data = {
          bookingDate: new Date(entry?.BookgDt?.Dt),
          valueDate: new Date(entry?.ValDt?.Dt),
          txCount: +entry?.NtryDtls?.Btch?.NbOfTxs,
          endToEndId: entry?.NtryDtls?.TxDtls?.Refs?.EndToEndId,
          instructionId: entry?.NtryDtls?.TxDtls?.Refs?.InstrId,
          txId: entry?.NtryDtls?.TxDtls?.Refs?.TxId,
          amount: +entry?.NtryDtls?.TxDtls?.Amt['#text'],
          currency: entry?.NtryDtls?.TxDtls?.Amt['@_Ccy'],
          creditDebitIndicator: entry?.NtryDtls?.TxDtls?.CdtDbtInd,
          instructedAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt['#text'],
          instructedCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt['@_Ccy'],
          txAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt['#text'],
          txCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt['@_Ccy'],
          exchangeSourceCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.SrcCcy,
          exchangeTargetCurrency: entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.TrgtCcy,
          exchangeRate: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.XchgRate,
          chargeAmount: +entry?.NtryDtls?.TxDtls?.Chrgs?.Rcrd?.Amt['#text'],
          chargeCurrency: entry?.NtryDtls?.TxDtls?.Chrgs?.Rcrd?.Amt['@_Ccy'],
          chargeCdi: entry?.NtryDtls?.TxDtls?.Chrgs?.Rcrd?.CdtDbtInd,
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
        batch: batch,
      };
    });
  }

  private static getRelatedPartyInfo(entry: SepaEntry): Partial<FiatInput> {
    const parties = entry?.NtryDtls?.TxDtls?.RltdPties;
    const { party, account } =
      entry?.NtryDtls?.TxDtls?.CdtDbtInd === SepaCdi.CREDIT
        ? { party: parties?.Dbtr, account: parties?.DbtrAcct }
        : { party: parties?.Cdtr, account: parties?.CdtrAcct };

    return {
      name: party?.Nm,
      ...this.getAddress(party?.PstlAdr),
      iban: account?.Id?.IBAN,
    };
  }

  private static getRelatedAgentInfo(entry: SepaEntry): Partial<FiatInput> {
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

  private static getAddress(address: SepaAddress): Partial<FiatInput> {
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
