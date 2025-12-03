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

export class CamtParserService {
  static parseCamtXml(xmlData: string, accountIban: string): CamtTransaction[] {
    const entryMatches = xmlData.match(/<Ntry>[\s\S]*?<\/Ntry>/g) || [];

    return entryMatches
      .filter((entry) => {
        const entryIban = CamtParserService.extractTag(entry, 'IBAN');
        return !entryIban || entryIban === accountIban;
      })
      .map((entry) => CamtParserService.parseCamtElement(entry, accountIban));
  }

  private static parseCamtElement(entryXml: string, accountIban: string): CamtTransaction {
    // amount and currency
    const amtMatch = entryXml.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
    const amount = amtMatch ? parseFloat(amtMatch[2]) : 0;
    const currency = amtMatch ? amtMatch[1] : 'CHF';

    // credit/debit indicator
    const creditDebitIndicator = CamtParserService.extractTag(entryXml, 'CdtDbtInd') as 'CRDT' | 'DBIT';
    if (!creditDebitIndicator) throw new Error(`Missing CdtDbtInd in CAMT entry`);

    // dates
    const bookingDateStr = CamtParserService.extractTag(entryXml, 'BookgDt');
    const valueDateStr = CamtParserService.extractTag(entryXml, 'ValDt');
    const bookingDate = bookingDateStr ? CamtParserService.parseDate(bookingDateStr) : new Date();
    const valueDate = valueDateStr ? CamtParserService.parseDate(valueDateStr) : bookingDate;

    // reference
    const accountServiceRef = CamtParserService.extractTag(entryXml, 'AcctSvcrRef') || Util.createUniqueId(accountIban);

    // transaction details (inside TxDtls)
    const txDtls = entryXml.match(/<TxDtls>[\s\S]*?<\/TxDtls>/)?.[0] || entryXml;

    // party information
    const name =
      CamtParserService.extractTag(txDtls, 'Nm') ||
      CamtParserService.extractNestedTag(txDtls, 'RltdPties', 'Dbtr', 'Nm') ||
      CamtParserService.extractNestedTag(txDtls, 'RltdPties', 'Cdtr', 'Nm');

    const iban =
      CamtParserService.extractTag(txDtls, 'IBAN') ||
      CamtParserService.extractNestedTag(txDtls, 'RltdPties', 'DbtrAcct', 'IBAN') ||
      CamtParserService.extractNestedTag(txDtls, 'RltdPties', 'CdtrAcct', 'IBAN');

    const bic =
      CamtParserService.extractTag(txDtls, 'BIC') ||
      CamtParserService.extractTag(txDtls, 'BICFI') ||
      CamtParserService.extractNestedTag(txDtls, 'RltdAgts', 'DbtrAgt', 'BIC');

    // remittance information
    const ustrd = CamtParserService.extractTag(txDtls, 'Ustrd');
    const strd = CamtParserService.extractTag(txDtls, 'Strd');
    const remittanceInfo = ustrd || strd;

    // end-to-end ID
    const endToEndId = CamtParserService.extractTag(txDtls, 'EndToEndId');

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
}
