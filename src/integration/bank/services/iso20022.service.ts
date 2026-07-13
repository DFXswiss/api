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

    // NtryDtls can be at root level (Yapeal format) or nested under Ntry (camt.054 spec)
    const entryDetails = camt054.BkToCstmrDbtCdtNtfctn?.NtryDtls ?? entry?.NtryDtls;

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
  static parseCamt053Json(camt053: any, accountIban: string, strict = false): CamtTransaction[] {
    const rawStatements = camt053?.BkToCstmrStmt?.Stmt;
    if (!rawStatements) {
      if (strict) throw new Error('Invalid camt.053 format: missing Stmt');
      return [];
    }
    const statements = Array.isArray(rawStatements) ? rawStatements : [rawStatements];

    const transactions: CamtTransaction[] = [];
    const fallbackOccurrences = new Map<string, number>();

    for (const stmt of statements) {
      if (strict) this.assertValidCamtStatement(stmt, accountIban);
      if (!stmt.Ntry) continue;
      const entries = Array.isArray(stmt.Ntry) ? stmt.Ntry : [stmt.Ntry];

      for (const entry of entries) {
        try {
          const stableReference = this.createStableCamtReference(accountIban, entry);
          const occurrence = fallbackOccurrences.get(stableReference) ?? 0;
          // Equal reference-less entries can be separate transfers. Preserve deterministic deduplication while
          // assigning each occurrence a distinct reference instead of silently collapsing a valid payment.
          const fallbackReference = occurrence === 0 ? stableReference : `${stableReference}-${occurrence + 1}`;

          const transaction = Iso20022Service.parseCamt053JsonEntry(entry, accountIban, strict, fallbackReference);
          fallbackOccurrences.set(stableReference, occurrence + 1);
          transactions.push(transaction);
        } catch (error) {
          if (strict) throw error;
          continue;
        }
      }
    }

    return transactions;
  }

  private static parseCamt053JsonEntry(
    entry: any,
    accountIban: string,
    strict = false,
    fallbackReference = this.createStableCamtReference(accountIban, entry),
  ): CamtTransaction {
    // amount and currency
    const amtObj = entry.Amt;
    const rawAmount = amtObj?.Value ?? amtObj?.['#text'] ?? amtObj;
    const amount = strict ? this.parseStrictCamtAmount(rawAmount) : parseFloat(rawAmount || '0');
    const currency = strict ? amtObj?.Ccy : amtObj?.Ccy || 'CHF';
    if (strict && (!Number.isFinite(amount) || amount <= 0)) throw new Error('Invalid amount in CAMT entry');
    if (strict && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)))
      throw new Error('Invalid currency in CAMT entry');

    // credit/debit indicator
    const cdtDbtInd = entry.CdtDbtInd;
    if (!cdtDbtInd) throw new Error('Missing CdtDbtInd in CAMT entry');
    if (strict && !['CRDT', 'DBIT'].includes(cdtDbtInd)) throw new Error('Invalid CdtDbtInd in CAMT entry');
    const creditDebitIndicator = cdtDbtInd === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT;

    // dates
    const bookingDateStr = this.getCamtDate(entry.BookgDt);
    const valueDateStr = this.getCamtDate(entry.ValDt);
    if (strict) this.assertValidCamtDate(bookingDateStr, 'booking');
    if (strict && valueDateStr !== undefined) this.assertValidCamtDate(valueDateStr, 'value');
    const bookingDate = bookingDateStr ? this.parseDate(bookingDateStr) : new Date();
    const valueDate = valueDateStr ? this.parseDate(valueDateStr) : bookingDate;

    const status = typeof entry.Sts === 'string' ? entry.Sts : entry.Sts?.Cd;
    if (strict && status !== CamtStatus.BOOKED) throw new Error('Invalid status in CAMT entry');

    // transaction details
    const entryDtls = entry.NtryDtls;
    const txDtlsArray = Array.isArray(entryDtls) ? entryDtls : entryDtls ? [entryDtls] : [];
    if (strict && txDtlsArray.length > 1) throw new Error('Ambiguous NtryDtls in CAMT entry');
    const firstDetail = txDtlsArray[0];
    const txDtlsList = firstDetail?.TxDtls;
    if (strict && Array.isArray(txDtlsList) && txDtlsList.length > 1) throw new Error('Ambiguous TxDtls in CAMT entry');
    const txDtls = Array.isArray(txDtlsList) ? txDtlsList[0] : txDtlsList || {};

    // party information - determine counterparty based on credit/debit
    const isCredit = creditDebitIndicator === BankTxIndicator.CREDIT;
    const parties = txDtls.RltdPties || {};
    const counterparty = this.unwrapCamtParty(isCredit ? parties.Dbtr : parties.Cdtr);
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
    const ultimateParty = this.unwrapCamtParty(isCredit ? parties.UltmtDbtr : parties.UltmtCdtr);
    const ultimateName = ultimateParty?.Nm;
    const ultimatePostalAddress = ultimateParty?.PstlAdr;
    const { addressLine1: ultimateAddressLine1, addressLine2: ultimateAddressLine2 } =
      this.parsePostalAddress(ultimatePostalAddress);
    const ultimateCountry = ultimatePostalAddress?.Ctry;

    // remittance information
    const remittanceInfo = this.parseCamtRemittanceInfo(txDtls.RmtInf, entry.AddtlNtryInf, strict);

    // reference - check transaction-level refs first (matches camt.054), then entry-level AcctSvcrRef
    const transactionAccountServiceRef = this.parseOptionalCamtString(txDtls.Refs?.AcctSvcrRef, 'AcctSvcrRef', strict);
    const transactionId = this.parseOptionalCamtString(txDtls.Refs?.TxId, 'TxId', strict);
    const entryAccountServiceRef = this.parseOptionalCamtString(entry.AcctSvcrRef, 'AcctSvcrRef', strict);
    const entryReference = this.parseOptionalCamtString(entry.NtryRef, 'NtryRef', strict);
    const accountServiceRef =
      transactionAccountServiceRef || transactionId || entryAccountServiceRef || entryReference || fallbackReference;

    // end-to-end ID
    const endToEndId = this.parseOptionalCamtString(txDtls.Refs?.EndToEndId, 'EndToEndId', strict) || '';

    // bank transaction codes
    const bkTxCd = (txDtls.BkTxCd ?? entry.BkTxCd)?.Domn;
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

  static parseCamt053Xml(xmlData: string, accountIban: string, strict = false): CamtTransaction[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
      // Identifiers such as AcctSvcrRef and EndToEndId may contain only digits. Keep element text as text so
      // parsing can never lose leading zeroes or precision before the strict CAMT validator sees it.
      parseTagValue: false,
    });

    const jsonData = parser.parse(xmlData);
    return this.parseCamt053Json(jsonData.Document || jsonData, accountIban, strict);
  }

  private static createStableCamtReference(accountIban: string, entry: unknown): string {
    const canonicalEntry = JSON.stringify(this.canonicalize(entry));
    return `CAMT-${Util.createHash(`${accountIban}:${canonicalEntry}`, 'sha256', 'hex')}`;
  }

  private static canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.canonicalize(entry));
    if (!value || typeof value !== 'object') return value;

    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) result[key] = this.canonicalize(entry);
        return result;
      }, {});
  }

  private static assertValidCamtStatement(statement: any, requestedAccountIban: string): void {
    const statementIban = statement?.Acct?.Id?.IBAN;
    if (typeof statementIban !== 'string' || !statementIban.trim())
      throw new Error('Invalid camt.053 format: missing account IBAN');

    const normalizeIban = (iban: string) => iban.replace(/\s/g, '').toUpperCase();
    if (normalizeIban(statementIban) !== normalizeIban(requestedAccountIban))
      throw new Error('Invalid camt.053 format: account IBAN mismatch');
  }

  private static getCamtDate(dateChoice: any): string | undefined {
    return dateChoice?.Dt ?? dateChoice?.DtTm;
  }

  private static unwrapCamtParty(party: any): any {
    return party?.Pty ?? party ?? {};
  }

  private static parseCamtRemittanceInfo(
    remittance: any,
    additionalEntryInfo: unknown,
    strict: boolean,
  ): string | undefined {
    if (remittance?.Ustrd !== undefined) {
      const values = Array.isArray(remittance.Ustrd) ? remittance.Ustrd : [remittance.Ustrd];
      if (values.every((value) => typeof value === 'string')) {
        const normalizedValues = values.map((value) => value.trim()).filter(Boolean);
        if (normalizedValues.length > 0) return normalizedValues.join(' ');
      }
      if (strict) throw new Error('Invalid unstructured remittance information in CAMT entry');
    }

    if (remittance?.Strd !== undefined) {
      if (typeof remittance.Strd === 'string' && remittance.Strd.trim()) return remittance.Strd.trim();
      const structures = Array.isArray(remittance.Strd) ? remittance.Strd : [remittance.Strd];
      const references = structures
        .map((structure) => structure?.CdtrRefInf?.Ref)
        .filter((reference): reference is string => typeof reference === 'string' && !!reference.trim())
        .map((reference) => reference.trim());
      if (references.length > 0) return references.join(' ');
      if (strict) throw new Error('Unsupported structured remittance information in CAMT entry');
    }

    return typeof additionalEntryInfo === 'string' && additionalEntryInfo.trim()
      ? additionalEntryInfo.trim()
      : undefined;
  }

  private static parseStrictCamtAmount(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))$/.test(value.trim())) return Number.NaN;
    return Number(value.trim());
  }

  private static parseOptionalCamtString(value: unknown, field: string, strict: boolean): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (strict) throw new Error(`Invalid ${field} in CAMT entry`);
    return undefined;
  }

  private static assertValidCamtDate(value: unknown, field: string): void {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}(?:(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))|(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?))?$/.test(
        value,
      )
    )
      throw new Error(`Invalid ${field} date in CAMT entry`);

    const isoDate = value.substring(0, 10);
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().substring(0, 10) !== isoDate)
      throw new Error(`Invalid ${field} date in CAMT entry`);

    if (value.includes('T') && Number.isNaN(new Date(value).getTime()))
      throw new Error(`Invalid ${field} date in CAMT entry`);
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
    if (dateStr.includes('T')) {
      // XML Schema permits DateTime values without a timezone. Interpret those consistently as UTC instead of
      // letting the server's local timezone change the imported value.
      const normalizedDateTime = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateStr) ? dateStr : `${dateStr}Z`;
      const dateTime = new Date(normalizedDateTime);
      if (!Number.isNaN(dateTime.getTime())) return dateTime;
    }
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
