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
  iban?: string;
  bic?: string;
  remittanceInfo?: string;
  endToEndId?: string;
  status: CamtStatus;
  accountIban: string;
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

    // amount and currency
    const amount = entry.Amt?.Value ?? 0;
    const currency = entry.Amt?.Ccy ?? 'CHF';

    // dates
    const bookingDate = entry.BookgDt?.Dt ? this.parseDate(entry.BookgDt.Dt) : new Date();
    const valueDate = entry.ValDt?.Dt ? this.parseDate(entry.ValDt.Dt) : bookingDate;

    // party information
    const isCredit = entry.CdtDbtInd === 'CDTN'; // CDTN / DBTN

    // credit: our account is creditor, counterparty is debtor
    // debit: our account is debtor, counterparty is creditor
    const ourAccount = isCredit ? txDetail?.RltdPties?.CdtrAcct : txDetail?.RltdPties?.DbtrAcct;
    const counterparty = isCredit ? txDetail?.RltdPties?.Dbtr : txDetail?.RltdPties?.Cdtr;
    const counterpartyAcct = isCredit ? txDetail?.RltdPties?.DbtrAcct : txDetail?.RltdPties?.CdtrAcct;
    const counterpartyAgent = isCredit ? txDetail?.RltdAgts?.DbtrAgt : txDetail?.RltdAgts?.CdtrAgt;

    const accountIban = ourAccount?.Id?.IBAN || notification.Acct?.Id?.IBAN;
    if (!accountIban) throw new Error('Invalid camt.054 format: missing account IBAN');

    const name = counterparty?.Nm;
    const iban = counterpartyAcct?.Id?.IBAN;
    const bic = counterpartyAgent?.FinInstnId?.BIC || counterpartyAgent?.FinInstnId?.BICFI;

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

    return {
      accountServiceRef,
      bookingDate,
      valueDate,
      amount,
      currency,
      creditDebitIndicator: entry.CdtDbtInd === 'CDTN' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      name,
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      status: entry.Sts as CamtStatus,
      accountIban,
    };
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

    // party information
    const name =
      Iso20022Service.extractTag(txDtls, 'Nm') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', 'Dbtr', 'Nm') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', 'Cdtr', 'Nm');

    const iban =
      Iso20022Service.extractTag(txDtls, 'IBAN') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', 'DbtrAcct', 'IBAN') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdPties', 'CdtrAcct', 'IBAN');

    const bic =
      Iso20022Service.extractTag(txDtls, 'BIC') ||
      Iso20022Service.extractTag(txDtls, 'BICFI') ||
      Iso20022Service.extractNestedTag(txDtls, 'RltdAgts', 'DbtrAgt', 'BIC');

    // remittance information
    const ustrd = Iso20022Service.extractTag(txDtls, 'Ustrd');
    const strd = Iso20022Service.extractTag(txDtls, 'Strd');
    const remittanceInfo = ustrd || strd;

    // end-to-end ID
    const endToEndId = Iso20022Service.extractTag(txDtls, 'EndToEndId');

    return {
      accountServiceRef,
      bookingDate,
      valueDate,
      amount,
      currency,
      creditDebitIndicator,
      name,
      iban,
      bic,
      remittanceInfo,
      endToEndId,
      status: CamtStatus.BOOKED, // camt.053 contains only booked transactions
      accountIban,
    };
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
