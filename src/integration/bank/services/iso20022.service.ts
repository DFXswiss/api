import { Util } from 'src/shared/utils/util';

export interface CamtTransaction {
  accountServiceRef: string;
  bookingDate: Date;
  valueDate: Date;
  amount: number;
  currency: string;
  creditDebitIndicator: 'CRDT' | 'DBIT';
  name?: string;
  iban?: string;
  bic?: string;
  remittanceInfo?: string;
  endToEndId?: string;
}

export interface Party {
  name: string;
  iban: string;
  bic?: string;
  country?: string;
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
  // --- CAMT PARSING --- //
  static parseCamtXml(xmlData: string, accountIban: string): CamtTransaction[] {
    const entryMatches = xmlData.match(/<Ntry>[\s\S]*?<\/Ntry>/g) || [];

    return entryMatches
      .filter((entry) => {
        const entryIban = Iso20022Service.extractTag(entry, 'IBAN');
        return !entryIban || entryIban === accountIban;
      })
      .map((entry) => Iso20022Service.parseCamtElement(entry, accountIban));
  }

  private static parseCamtElement(entryXml: string, accountIban: string): CamtTransaction {
    // amount and currency
    const amtMatch = entryXml.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
    const amount = amtMatch ? parseFloat(amtMatch[2]) : 0;
    const currency = amtMatch ? amtMatch[1] : 'CHF';

    // credit/debit indicator
    const creditDebitIndicator = Iso20022Service.extractTag(entryXml, 'CdtDbtInd') as 'CRDT' | 'DBIT';
    if (!creditDebitIndicator) throw new Error(`Missing CdtDbtInd in CAMT entry`);

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
