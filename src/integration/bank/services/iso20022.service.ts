import { XMLParser } from 'fast-xml-parser';
import { Util } from 'src/shared/utils/util';
import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';

export enum CamtStatus {
  BOOKED = 'BOOK',
  PENDING = 'PDNG',
  INFO = 'INFO',
  REJECTED = 'RJCT',
}

export interface CamtTransaction {
  accountServiceRef: string;
  bookingDate: Date;
  valueDate: Date;

  creditDebitIndicator: BankTxIndicator;
  amount: number;
  currency: string;
  instructedAmount?: number;
  instructedCurrency?: string;
  txAmount?: number;
  txCurrency?: string;
  exchangeSourceCurrency?: string;
  exchangeTargetCurrency?: string;
  exchangeRate?: number;

  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  country?: string;

  ultimateName?: string;
  ultimateAddressLine1?: string;
  ultimateAddressLine2?: string;
  ultimateCountry?: string;

  iban?: string;
  bic?: string;
  accountIban: string;
  virtualIban?: string;

  remittanceInfo?: string;
  endToEndId?: string;
  status: CamtStatus;
  domainCode?: string;
  familyCode?: string;
  subFamilyCode?: string;
}

export interface Party {
  name: string;
  address?: string;
  houseNumber?: string;
  zip?: string;
  city?: string;
  country: string;

  iban: string;
  bic?: string;
}

export interface Pain001Payment {
  messageId: string;
  endToEndId: string;
  amount: number;
  currency: 'CHF' | 'EUR';
  debtor: Party;
  creditor: Party;
  remittanceInfo?: string;
  executionDate?: Date;
}

export class Iso20022Service {
  // --- CAMT.054 PARSING --- //
  static parseCamt054Json(camt054: any): CamtTransaction {
    const notification = camt054.BkToCstmrDbtCdtNtfctn?.Ntfctn;
    if (!notification) throw new Error('Invalid camt.054 format: missing Ntfctn');

    const entry = notification.Ntry;
    const entryDetails = camt054.BkToCstmrDbtCdtNtfctn?.NtryDtls;

    // transaction details
    const txDetails = entryDetails?.TxDtls;
    const txDetail = Array.isArray(txDetails) ? txDetails[0] : txDetails;

    // dates
    const bookingDate = entry.BookgDt?.Dt ? this.parseDate(entry.BookgDt.Dt) : new Date();
    const valueDate = entry.ValDt?.Dt ? this.parseDate(entry.ValDt.Dt) : bookingDate;

    // amount and currency
    const amount = entry.Amt?.Value;
    const currency = entry.Amt?.Ccy;

    const isCredit = entry.CdtDbtInd === 'CDTN'; // CDTN / DBTN

    // receiving account
    const accountIban = notification.Acct?.Id?.IBAN;
    if (!accountIban) throw new Error('Invalid camt.054 format: missing account IBAN');

    const creditorIban = txDetail?.RltdPties?.CdtrAcct?.Id?.IBAN;
    const virtualIban = isCredit && creditorIban !== accountIban ? creditorIban : undefined;

    // counterparty info
    const counterparty = isCredit ? txDetail?.RltdPties?.Dbtr : txDetail?.RltdPties?.Cdtr;
    const counterpartyAcct = isCredit ? txDetail?.RltdPties?.DbtrAcct : txDetail?.RltdPties?.CdtrAcct;
    const counterpartyAgent = isCredit ? txDetail?.RltdAgts?.DbtrAgt : txDetail?.RltdAgts?.CdtrAgt;

    const name = counterparty?.Nm;
    const iban = counterpartyAcct?.Id?.IBAN;
    const bic = counterpartyAgent?.FinInstnId?.BIC || counterpartyAgent?.FinInstnId?.BICFI;

    // address info
    const postalAddress = counterparty?.PstlAdr;
    const { addressLine1, addressLine2 } = this.parsePostalAddress(postalAddress);
    const country = postalAddress?.Ctry;

    // ultimate party info (actual sender/receiver behind intermediary banks like Wise/Revolut)
    const ultimateParty = isCredit ? txDetail?.RltdPties?.UltmtDbtr : txDetail?.RltdPties?.UltmtCdtr;
    const ultimateName = ultimateParty?.Nm;
    const ultimatePostalAddress = ultimateParty?.PstlAdr;
    const { addressLine1: ultimateAddressLine1, addressLine2: ultimateAddressLine2 } =
      this.parsePostalAddress(ultimatePostalAddress);
    const ultimateCountry = ultimatePostalAddress?.Ctry;

    // remittance info
    let remittanceInfo: string | undefined;
    if (txDetail?.RmtInf?.Ustrd) {
      const ustrd = txDetail.RmtInf.Ustrd;
      remittanceInfo = Array.isArray(ustrd) ? ustrd.join(' ') : ustrd;
    } else if (txDetail?.RmtInf?.Strd) {
      remittanceInfo = txDetail.RmtInf.Strd;
    }

    // references
    const accountServiceRef = txDetail?.Refs?.AcctSvcrRef || txDetail?.Refs?.TxId || notification.Id;
    const endToEndId = txDetail?.Refs?.EndToEndId;

    // bank transaction codes
    const bkTxCd = txDetail?.BkTxCd?.Domn;
    const domainCode = bkTxCd?.Cd;
    const familyCode = bkTxCd?.Fmly?.Cd;
    const subFamilyCode = bkTxCd?.Fmly?.SubFmlyCd;

    // currency exchange information
    const amtDtls = txDetail?.AmtDtls;
    const instructedAmount = amtDtls?.InstdAmt?.Amt?.Value;
    const instructedCurrency = amtDtls?.InstdAmt?.Amt?.Ccy;
    const txAmount = amtDtls?.TxAmt?.Amt?.Value;
    const txCurrency = amtDtls?.TxAmt?.Amt?.Ccy;
    const exchangeSourceCurrency = amtDtls?.InstdAmt?.CcyXchg?.SrcCcy;
    const exchangeTargetCurrency = amtDtls?.InstdAmt?.CcyXchg?.TrgtCcy;
    const exchangeRate = amtDtls?.InstdAmt?.CcyXchg?.XchgRate;

    return {
      accountServiceRef,
      bookingDate,
      valueDate,
      creditDebitIndicator: entry.CdtDbtInd === 'CDTN' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      amount,
      currency,
      instructedAmount,
      instructedCurrency,
      txAmount,
      txCurrency,
      exchangeSourceCurrency,
      exchangeTargetCurrency,
      exchangeRate,
      name,
      addressLine1,
      addressLine2,
      country,
      ultimateName,
      ultimateAddressLine1,
      ultimateAddressLine2,
      ultimateCountry,
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      status: entry.Sts as CamtStatus,
      accountIban,
      virtualIban,
      domainCode,
      familyCode,
      subFamilyCode,
    };
  }

  private static parsePostalAddress(postalAddress: any): { addressLine1?: string; addressLine2?: string } {
    if (!postalAddress) return {};

    // AdrLine format (array of address lines)
    if (postalAddress.AdrLine) {
      const lines = Array.isArray(postalAddress.AdrLine) ? postalAddress.AdrLine : [postalAddress.AdrLine];
      return {
        addressLine1: lines[0],
        addressLine2: lines[1],
      };
    }

    // structured format (StrtNm, BldgNb, PstCd, TwnNm)
    if (postalAddress.StrtNm || postalAddress.TwnNm) {
      const streetPart = [postalAddress.StrtNm, postalAddress.BldgNb].filter(Boolean).join(' ');
      const cityPart = [postalAddress.PstCd, postalAddress.TwnNm].filter(Boolean).join(' ');
      return {
        addressLine1: streetPart || undefined,
        addressLine2: cityPart || undefined,
      };
    }

    return {};
  }

  // --- CAMT.053 PARSING --- //
  static parseCamt053Json(camt053: any, accountIban: string): CamtTransaction[] {
    const statements = camt053?.BkToCstmrStmt?.Stmt;
    if (!statements || !Array.isArray(statements)) return [];

    const transactions: CamtTransaction[] = [];

    for (const stmt of statements) {
      if (!stmt.Ntry || !Array.isArray(stmt.Ntry)) continue;

      for (const entry of stmt.Ntry) {
        try {
          transactions.push(Iso20022Service.parseCamt053JsonEntry(entry, accountIban));
        } catch {
          continue;
        }
      }
    }

    return transactions;
  }

  private static parseCamt053JsonEntry(entry: any, accountIban: string): CamtTransaction {
    // amount and currency
    const amtObj = entry.Amt;
    const amount = parseFloat(amtObj?.Value || amtObj?.['#text'] || amtObj || '0');
    const currency = amtObj?.Ccy || 'CHF';

    // credit/debit indicator
    const cdtDbtInd = entry.CdtDbtInd;
    if (!cdtDbtInd) throw new Error('Missing CdtDbtInd in CAMT entry');
    const creditDebitIndicator = cdtDbtInd === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT;

    // dates
    const bookingDateStr = entry.BookgDt?.Dt;
    const valueDateStr = entry.ValDt?.Dt;
    const bookingDate = bookingDateStr ? this.parseDate(bookingDateStr) : new Date();
    const valueDate = valueDateStr ? this.parseDate(valueDateStr) : bookingDate;

    // reference
    const accountServiceRef = entry.NtryRef || entry.AcctSvcrRef || Util.createUniqueId(accountIban);

    // transaction details
    const entryDtls = entry.NtryDtls;
    const txDtlsArray = Array.isArray(entryDtls) ? entryDtls : entryDtls ? [entryDtls] : [];
    const firstDetail = txDtlsArray[0];
    const txDtlsList = firstDetail?.TxDtls;
    const txDtls = Array.isArray(txDtlsList) ? txDtlsList[0] : txDtlsList || {};

    // party information - determine counterparty based on credit/debit
    const isCredit = creditDebitIndicator === BankTxIndicator.CREDIT;
    const parties = txDtls.RltdPties || {};
    const counterparty = isCredit ? parties.Dbtr : parties.Cdtr;
    const counterpartyAcct = isCredit ? parties.DbtrAcct : parties.CdtrAcct;
    const counterpartyAgent = isCredit ? txDtls.RltdAgts?.DbtrAgt : txDtls.RltdAgts?.CdtrAgt;

    const name = counterparty?.Nm || '';
    const iban = counterpartyAcct?.Id?.IBAN || '';
    const bic = counterpartyAgent?.FinInstnId?.BIC || counterpartyAgent?.FinInstnId?.BICFI;

    // address information from PstlAdr
    const postalAddress = counterparty?.PstlAdr;
    const { addressLine1, addressLine2 } = this.parsePostalAddress(postalAddress);
    const country = postalAddress?.Ctry;

    // ultimate party info (actual sender/receiver behind intermediary banks like Wise/Revolut)
    const ultimateParty = isCredit ? parties.UltmtDbtr : parties.UltmtCdtr;
    const ultimateName = ultimateParty?.Nm;
    const ultimatePostalAddress = ultimateParty?.PstlAdr;
    const { addressLine1: ultimateAddressLine1, addressLine2: ultimateAddressLine2 } =
      this.parsePostalAddress(ultimatePostalAddress);
    const ultimateCountry = ultimatePostalAddress?.Ctry;

    // remittance information
    let remittanceInfo: string | undefined;
    if (txDtls.RmtInf?.Ustrd) {
      const ustrd = txDtls.RmtInf.Ustrd;
      remittanceInfo = Array.isArray(ustrd) ? ustrd.join(' ') : ustrd;
    } else if (txDtls.RmtInf?.Strd) {
      remittanceInfo = txDtls.RmtInf.Strd;
    } else if (entry.AddtlNtryInf) {
      remittanceInfo = entry.AddtlNtryInf;
    }

    // end-to-end ID
    const endToEndId = txDtls.Refs?.EndToEndId || '';

    // bank transaction codes
    const bkTxCd = txDtls.BkTxCd?.Domn;
    const domainCode = bkTxCd?.Cd;
    const familyCode = bkTxCd?.Fmly?.Cd;
    const subFamilyCode = bkTxCd?.Fmly?.SubFmlyCd;

    return {
      accountServiceRef,
      bookingDate,
      valueDate,
      amount,
      currency,
      creditDebitIndicator,
      name,
      addressLine1,
      addressLine2,
      country,
      ultimateName,
      ultimateAddressLine1,
      ultimateAddressLine2,
      ultimateCountry,
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      status: CamtStatus.BOOKED, // camt.053 contains only booked transactions
      accountIban,
      virtualIban: undefined, // not available in camt.053 format
      domainCode,
      familyCode,
      subFamilyCode,
    };
  }

  static parseCamt053Xml(xmlData: string, accountIban: string): CamtTransaction[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
    });

    const jsonData = parser.parse(xmlData);
    return this.parseCamt053Json(jsonData.Document || jsonData, accountIban);
  }

  // --- PAIN.001 GENERATION --- //

  static createPain001Json(payment: Pain001Payment): any {
    return {
      CstmrCdtTrfInitn: {
        GrpHdr: {
          MsgId: payment.messageId,
          NbOfTxs: '1',
          CtrlSum: payment.amount,
          InitgPty: {
            Nm: payment.debtor.name,
          },
        },
        PmtInf: [
          {
            Dbtr: {
              Nm: payment.debtor.name,
              PstlAdr: {
                Ctry: payment.debtor.country,
              },
            },
            DbtrAcct: {
              Id: {
                IBAN: payment.debtor.iban,
              },
              Ccy: payment.currency,
            },
            CdtTrfTxInf: [
              {
                PmtId: {
                  EndToEndId: payment.endToEndId,
                },
                Amt: {
                  InstdAmt: {
                    Ccy: payment.currency,
                    value: payment.amount,
                  },
                },
                Cdtr: {
                  Nm: payment.creditor.name,
                  PstlAdr: {
                    ...(payment.creditor.address && { StrtNm: payment.creditor.address }),
                    ...(payment.creditor.houseNumber && { BldgNb: payment.creditor.houseNumber }),
                    ...(payment.creditor.zip && { PstCd: payment.creditor.zip }),
                    ...(payment.creditor.city && { TwnNm: payment.creditor.city }),
                    Ctry: payment.creditor.country,
                  },
                },
                CdtrAcct: {
                  Id: {
                    IBAN: payment.creditor.iban,
                  },
                },
                ...(payment.remittanceInfo && {
                  RmtInf: {
                    Ustrd: payment.remittanceInfo,
                  },
                }),
              },
            ],
          },
        ],
      },
    };
  }

  static createPain001Xml(payment: Pain001Payment): string {
    const creationDateTime = new Date().toISOString();
    const executionDate = Util.isoDate(payment.executionDate || new Date());
    const amount = payment.amount.toFixed(2);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${payment.messageId}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <InitgPty>
        <Nm>${Iso20022Service.escapeXml(payment.debtor.name)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${payment.messageId}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${executionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${Iso20022Service.escapeXml(payment.debtor.name)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${payment.debtor.iban}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>${payment.debtor.bic}</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${payment.endToEndId}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="${payment.currency}">${amount}</InstdAmt>
        </Amt>
        <CdtrAgt><FinInstnId><BIC>${payment.creditor.bic}</BIC></FinInstnId></CdtrAgt>
        <Cdtr>
          <Nm>${Iso20022Service.escapeXml(payment.creditor.name)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${payment.creditor.iban}</IBAN>
          </Id>
        </CdtrAcct>
        ${
          payment.remittanceInfo
            ? `<RmtInf><Ustrd>${Iso20022Service.escapeXml(payment.remittanceInfo)}</Ustrd></RmtInf>`
            : ''
        }
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
  }

  // --- XML HELPER METHODS --- //

  private static parseDate(dateStr: string): Date {
    const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    return dateMatch ? new Date(dateMatch[1]) : new Date();
  }

  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
