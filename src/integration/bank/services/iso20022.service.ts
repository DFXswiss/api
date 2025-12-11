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
  amount: number;
  currency: string;
  creditDebitIndicator: BankTxIndicator;
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  country?: string;
  iban?: string;
  bic?: string;
  remittanceInfo?: string;
  endToEndId?: string;
  status: CamtStatus;
  accountIban: string;
  virtualIban?: string;
  // ISO 20022 Bank Transaction Code (BkTxCd)
  txDomainCode?: string; // e.g. PMNT (Payment)
  txFamilyCode?: string; // e.g. RCDT (Received Credit), ICDT (Issued Credit), DMCT, STDO, SALA, FEES
  txSubFamilyCode?: string; // e.g. AUTT (Automated), ESCT, DMCT
}

export interface Party {
  name: string;
  address?: string;
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

    // address info from PstlAdr
    const postalAddress = counterparty?.PstlAdr;
    const { addressLine1, addressLine2 } = this.parsePostalAddress(postalAddress);
    const country = postalAddress?.Ctry;

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

    // Bank Transaction Code (BkTxCd)
    const bkTxCd = txDetail?.BkTxCd?.Domn;
    const txDomainCode = bkTxCd?.Cd;
    const txFamilyCode = bkTxCd?.Fmly?.Cd;
    const txSubFamilyCode = bkTxCd?.Fmly?.SubFmlyCd;

    return {
      accountServiceRef,
      bookingDate,
      valueDate,
      amount,
      currency,
      creditDebitIndicator: entry.CdtDbtInd === 'CDTN' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      name,
      addressLine1,
      addressLine2,
      country,
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      txDomainCode,
      txFamilyCode,
      txSubFamilyCode,
      status: entry.Sts as CamtStatus,
      accountIban,
      virtualIban,
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

    // Structured format (StrtNm, BldgNb, PstCd, TwnNm)
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
  static parseCamt053Xml(xmlData: string, accountIban: string): CamtTransaction[] {
    const entryMatches = xmlData.match(/<Ntry>[\s\S]*?<\/Ntry>/g) || [];

    return entryMatches
      .filter((entry) => {
        const entryIban = Iso20022Service.extractTag(entry, 'IBAN');
        return !entryIban || entryIban === accountIban;
      })
      .map((entry) => Iso20022Service.parseCamt053Element(entry, accountIban));
  }

  private static parseCamt053Element(entryXml: string, accountIban: string): CamtTransaction {
    // amount and currency
    const amtMatch = entryXml.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
    const amount = amtMatch ? parseFloat(amtMatch[2]) : 0;
    const currency = amtMatch ? amtMatch[1] : 'CHF';

    // credit/debit indicator
    const cdtDbtInd = Iso20022Service.extractTag(entryXml, 'CdtDbtInd');
    if (!cdtDbtInd) throw new Error(`Missing CdtDbtInd in CAMT entry`);
    const creditDebitIndicator = cdtDbtInd === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT;

    // dates
    const bookingDateStr = Iso20022Service.extractTag(entryXml, 'BookgDt');
    const valueDateStr = Iso20022Service.extractTag(entryXml, 'ValDt');
    const bookingDate = bookingDateStr ? Iso20022Service.parseDate(bookingDateStr) : new Date();
    const valueDate = valueDateStr ? Iso20022Service.parseDate(valueDateStr) : bookingDate;

    // reference
    const accountServiceRef = Iso20022Service.extractTag(entryXml, 'AcctSvcrRef') || Util.createUniqueId(accountIban);

    // transaction details (inside TxDtls)
    const txDtls = entryXml.match(/<TxDtls>[\s\S]*?<\/TxDtls>/)?.[0] || entryXml;

    // party information - determine counterparty based on credit/debit
    const isCredit = creditDebitIndicator === BankTxIndicator.CREDIT;
    const counterpartyTag = isCredit ? 'Dbtr' : 'Cdtr';

    const name =
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', counterpartyTag, 'Nm') ||
      Iso20022Service.extractTag(txDtls, 'Nm');

    const iban =
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', `${counterpartyTag}Acct`, 'IBAN') ||
      Iso20022Service.extractTag(txDtls, 'IBAN');

    const bic =
      Iso20022Service.extractTag(txDtls, 'BIC') ||
      Iso20022Service.extractTag(txDtls, 'BICFI') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdAgts', `${counterpartyTag}Agt`, 'BIC');

    // address information from PstlAdr
    const { addressLine1, addressLine2, country } = Iso20022Service.extractAddressFromXml(txDtls, counterpartyTag);

    // remittance information
    const ustrd = Iso20022Service.extractTag(txDtls, 'Ustrd');
    const strd = Iso20022Service.extractTag(txDtls, 'Strd');
    const remittanceInfo = ustrd || strd;

    // end-to-end ID
    const endToEndId = Iso20022Service.extractTag(txDtls, 'EndToEndId');

    // Bank Transaction Code (BkTxCd)
    const { txDomainCode, txFamilyCode, txSubFamilyCode } = Iso20022Service.extractBkTxCdFromXml(txDtls);

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
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      txDomainCode,
      txFamilyCode,
      txSubFamilyCode,
      status: CamtStatus.BOOKED, // camt.053 contains only booked transactions
      accountIban,
      virtualIban: undefined, // not available in camt.053 format
    };
  }

  private static extractAddressFromXml(
    xml: string,
    partyTag: string,
  ): { addressLine1?: string; addressLine2?: string; country?: string } {
    // Try to extract PstlAdr block from RltdPties > Dbtr/Cdtr > PstlAdr
    const partyMatch = xml.match(new RegExp(`<${partyTag}>[\\s\\S]*?</${partyTag}>`));
    if (!partyMatch) return {};

    const partyXml = partyMatch[0];
    const pstlAdrMatch = partyXml.match(/<PstlAdr>[\s\S]*?<\/PstlAdr>/);
    if (!pstlAdrMatch) return {};

    const pstlAdr = pstlAdrMatch[0];

    // Extract country
    const country = Iso20022Service.extractTag(pstlAdr, 'Ctry');

    // Try AdrLine format first
    const adrLines = pstlAdr.match(/<AdrLine>([^<]*)<\/AdrLine>/g);
    if (adrLines && adrLines.length > 0) {
      const extractedLines = adrLines.map((line) => line.replace(/<\/?AdrLine>/g, '').trim());
      return {
        addressLine1: extractedLines[0],
        addressLine2: extractedLines[1],
        country,
      };
    }

    // Try structured format (StrtNm, BldgNb, PstCd, TwnNm)
    const strtNm = Iso20022Service.extractTag(pstlAdr, 'StrtNm');
    const bldgNb = Iso20022Service.extractTag(pstlAdr, 'BldgNb');
    const pstCd = Iso20022Service.extractTag(pstlAdr, 'PstCd');
    const twnNm = Iso20022Service.extractTag(pstlAdr, 'TwnNm');

    if (strtNm || twnNm) {
      const streetPart = [strtNm, bldgNb].filter(Boolean).join(' ');
      const cityPart = [pstCd, twnNm].filter(Boolean).join(' ');
      return {
        addressLine1: streetPart || undefined,
        addressLine2: cityPart || undefined,
        country,
      };
    }

    return { country };
  }

  private static extractBkTxCdFromXml(xml: string): {
    txDomainCode?: string;
    txFamilyCode?: string;
    txSubFamilyCode?: string;
  } {
    const bkTxCdMatch = xml.match(/<BkTxCd>[\s\S]*?<\/BkTxCd>/);
    if (!bkTxCdMatch) return {};

    const bkTxCd = bkTxCdMatch[0];
    const txDomainCode = Iso20022Service.extractNestedTag(bkTxCd, 'Domn', 'Cd');
    const txFamilyCode = Iso20022Service.extractNestedTag(bkTxCd, 'Domn', 'Fmly', 'Cd');
    const txSubFamilyCode = Iso20022Service.extractNestedTag(bkTxCd, 'Domn', 'Fmly', 'SubFmlyCd');

    return { txDomainCode, txFamilyCode, txSubFamilyCode };
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

  private static extractTag(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1]?.trim();
  }

  private static extractNestedTag(xml: string, ...tags: string[]): string | undefined {
    let current = xml;
    for (const tag of tags) {
      const match = current.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`));
      if (!match) return undefined;
      current = match[0];
    }

    const textMatch = current.match(/>([^<]+)</);
    return textMatch?.[1]?.trim();
  }

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
