import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { FileSubType } from '../dto/kyc-file.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../entities/name-check-log.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';

type FinancialData = Record<string, string>;

// The overlay text is drawn with an embedded Unicode font instead of a PDF standard font: standard
// fonts are limited to WinAnsi and throw on every name, street or employer outside Latin-1
// (Polish, Turkish, Baltic, Cyrillic, ...), which would leave those cases without a document.
// Liberation Sans is metrically compatible with Arial/Helvetica, so the layout is unchanged.
const FONT_DIRECTORY = '../assets/fonts';
const REGULAR_FONT_FILE = 'LiberationSans-Regular.ttf';
const BOLD_FONT_FILE = 'LiberationSans-Bold.ttf';
const REPLACEMENT_CHARACTER = '?';

// Income and asset bands as answered in the FinancialData step, mapped to the wording of the
// productive Sheet template.
const FINANCIAL_BANDS: Record<string, string> = {
  '1m': " > 1'000'000 CHF",
  '500k_1m': "zwischen 500'000 und 1'000'000 CHF",
  '100k_500k': "zwischen 100'000 und 500'000 CHF",
  '50k_100k': "zwischen 0 und 100'000 CHF",
  '50k': "zwischen 0 und 100'000 CHF",
};

interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  encodable: Set<number>;
}

export interface DfxApprovalPdfContext {
  userData: UserData;
  steps: KycStep[];
  nameCheck?: NameCheckLog;
  generatedAt: Date;
  // Set when the document was already registered under this name; keeps a regenerated document
  // consistent with the stored file name.
  documentName?: string;
}

interface TextOptions {
  x: number;
  top: number;
  width?: number;
  height?: number;
  size?: number;
  color?: ReturnType<typeof rgb>;
  bold?: boolean;
}

const BLUE = rgb(0, 0, 1);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const TEMPLATE_FILES: Partial<Record<FileSubType, string>> = {
  [FileSubType.GWG_FILE_COVER]: 'gwg-file-cover.pdf',
  [FileSubType.IDENTIFICATION_FORM]: 'identification-form.pdf',
  [FileSubType.CUSTOMER_PROFILE]: 'customer-profile.pdf',
  [FileSubType.RISK_PROFILE]: 'risk-profile.pdf',
  [FileSubType.FORM_A]: 'form-a.pdf',
  [FileSubType.DFX_NAME_CHECK]: 'name-check.pdf',
};

@Injectable()
export class DfxApprovalPdfService {
  private readonly logger = new DfxLogger(DfxApprovalPdfService);

  private fontFiles?: Promise<[Buffer, Buffer]>;

  async generate(subType: FileSubType, context: DfxApprovalPdfContext): Promise<Buffer> {
    const templateFile = TEMPLATE_FILES[subType];
    if (!templateFile) throw new Error(`Unsupported DfxApproval document subtype ${subType}`);

    const template = await readFile(join(__dirname, '../assets/dfx-approval', templateFile));
    const pdf = await PDFDocument.load(template);
    const fonts = await this.embedFonts(pdf);

    switch (subType) {
      case FileSubType.GWG_FILE_COVER:
        this.renderCover(pdf, fonts, context);
        break;
      case FileSubType.IDENTIFICATION_FORM:
        this.renderIdentificationForm(pdf, fonts, context);
        break;
      case FileSubType.CUSTOMER_PROFILE:
        this.renderCustomerProfile(pdf, fonts, context);
        break;
      case FileSubType.RISK_PROFILE:
        this.renderRiskProfile(pdf, fonts, context);
        break;
      case FileSubType.FORM_A:
        this.renderFormA(pdf, fonts, context);
        break;
      case FileSubType.DFX_NAME_CHECK:
        this.renderNameCheck(pdf, fonts, context);
        break;
    }

    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  }

  fileName(subType: FileSubType, context: DfxApprovalPdfContext): string {
    const label = {
      [FileSubType.GWG_FILE_COVER]: 'GwGFileDeckblatt',
      [FileSubType.IDENTIFICATION_FORM]: 'Identifizierungsformular',
      [FileSubType.CUSTOMER_PROFILE]: 'Kundenprofil',
      [FileSubType.RISK_PROFILE]: 'Risikoprofil',
      [FileSubType.FORM_A]: 'FormularA',
      [FileSubType.DFX_NAME_CHECK]: 'NameCheck',
    }[subType];
    if (!label) throw new Error(`Unsupported DfxApproval document subtype ${subType}`);
    const documentDate =
      subType === FileSubType.DFX_NAME_CHECK ? this.requiredNameCheck(context).created : context.generatedAt;
    return `${this.compactDate(documentDate)}-${label}-0-${context.userData.id}-${this.compactTime(context.generatedAt)}.pdf`;
  }

  private renderCover(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const page = pdf.getPage(0);
    page.drawRectangle({ x: 292, y: page.getHeight() - 116, width: 120, height: 14, color: WHITE });
    this.text(page, fonts, String(context.userData.id), { x: 296.4, top: 70.2 });
    this.text(page, fonts, this.documentNumber(FileSubType.GWG_FILE_COVER, context), {
      x: 296.4,
      top: 86.7,
      width: 245,
    });
    this.text(page, fonts, this.timestamp(context.generatedAt), { x: 296.4, top: 103.2, width: 160 });
    this.text(page, fonts, 'Privatperson', { x: 296.4, top: 119.7 });
    this.text(page, fonts, context.userData.verifiedName, { x: 296.4, top: 136.2, width: 245 });
    this.text(page, fonts, context.userData.naturalPersonName, { x: 296.4, top: 152.7, width: 245 });
  }

  private renderNameCheck(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const nameCheck = this.requiredNameCheck(context);
    const page = pdf.getPage(0);
    this.text(page, fonts, String(context.userData.id), { x: 198.6, top: 70.1 });
    this.text(page, fonts, this.documentNumber(FileSubType.DFX_NAME_CHECK, context), {
      x: 198.6,
      top: 86.6,
      width: 245,
    });
    this.text(page, fonts, this.timestamp(nameCheck.created), { x: 198.6, top: 103.1 });
    this.text(page, fonts, 'Privatperson', { x: 198.6, top: 119.5 });
    this.text(page, fonts, context.userData.verifiedName, { x: 198.6, top: 136.0, width: 245 });
    this.text(page, fonts, this.timestamp(nameCheck.created), { x: 198.6, top: 200.5 });
    this.text(page, fonts, this.nameCheckResult(nameCheck), { x: 198.6, top: 217.0, width: 245 });
    this.text(page, fonts, nameCheck.result, { x: 198.6, top: 233.5, width: 360, height: 12 });
  }

  private renderFormA(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const page = pdf.getPage(0);
    const value = (text: unknown, top: number, height = 16): void =>
      this.text(page, fonts, text, { x: 202, top, width: 365, height, color: BLUE, bold: true, size: 9 });
    value(context.userData.id, 82.3);
    value(context.userData.verifiedName, 231.9);
    value(context.userData.surname, 349.6);
    value(context.userData.firstname, 371.5);
    value(this.date(context.userData.birthday), 393.4);
    value(context.userData.nationality?.name, 415.4);
    value(this.address(context.userData), 437.3, 30);
    this.text(page, fonts, this.timestamp(context.userData.created), {
      x: 16.5,
      top: 549.5,
      width: 180,
      color: BLUE,
      bold: true,
      size: 9,
    });
  }

  private renderIdentificationForm(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const first = pdf.getPage(0);
    const value = (text: unknown, top: number, height = 18): void =>
      this.text(first, fonts, text, { x: 257.1, top, width: 305, height, color: BLUE, bold: true, size: 9 });
    this.text(first, fonts, context.userData.id, {
      x: 420.3,
      top: 46.3,
      width: 135,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.text(first, fonts, this.timestamp(context.generatedAt), {
      x: 158.4,
      top: 211.8,
      width: 395,
      color: BLUE,
      bold: true,
      size: 9,
    });
    value(context.userData.naturalPersonName, 294.5);
    value(this.address(context.userData), 318.2);
    value(context.userData.phone, 342.0);
    value(context.userData.mail, 365.7);
    value(this.date(context.userData.birthday), 389.5);
    value(context.userData.nationality?.name, 413.2);
    value(context.userData.identDocumentType, 437.0);

    const second = pdf.getPage(1);
    this.text(second, fonts, this.timestamp(context.userData.created), {
      x: 257.1,
      top: 402.1,
      width: 305,
      color: BLUE,
      bold: true,
      size: 9,
    });
    const identificationType = context.userData.identificationType;
    [424.5, 446.0, 465.0].forEach((top) => this.uncheck(second, 239.3, top));
    if (identificationType === KycIdentificationType.VIDEO_ID) this.check(second, 239.3, 424.5);
    else if (identificationType === KycIdentificationType.MANUAL) this.check(second, 239.3, 465.0);
    else this.check(second, 239.3, 446.0);

    const language = context.userData.language?.name;
    [522.5, 546.3].forEach((top) => this.uncheck(second, 239.3, top));
    [522.5, 546.3].forEach((top) => this.uncheck(second, 402.5, top));
    if (language === 'German' || language === 'Portuguese') this.check(second, 239.3, 522.5);
    else if (language === 'Italian') this.check(second, 239.3, 546.3);
    else if (language === 'French') this.check(second, 402.5, 546.3);
    else this.check(second, 402.5, 522.5);

    const third = pdf.getPage(2);
    this.uncheck(third, 233.5, 118.5);
    this.check(third, 233.5, 118.5);

    const fourth = pdf.getPage(3);
    this.uncheck(fourth, 239.3, 202.0);
    this.uncheck(fourth, 239.3, 219.0);
    if (context.userData.sellVolume > 0) this.check(fourth, 239.3, 202.0);
    if (context.userData.cryptoVolume > 0) this.check(fourth, 239.3, 219.0);
  }

  private renderCustomerProfile(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const financial = this.financialData(context.steps);
    const first = pdf.getPage(0);
    const value = (text: unknown, top: number, height = 20): void =>
      this.text(first, fonts, text, { x: 249, top, width: 322, height, color: BLUE, bold: true, size: 8.7 });
    this.text(first, fonts, context.userData.id, {
      x: 440.1,
      top: 83,
      width: 125,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.text(first, fonts, context.userData.verifiedName, {
      x: 159,
      top: 270.9,
      width: 410,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.text(first, fonts, this.timestamp(context.generatedAt), {
      x: 159,
      top: 368.1,
      width: 410,
      color: BLUE,
      bold: true,
      size: 9,
    });
    value(this.employment(financial), 440.4, 56);
    value(this.financialBand(financial.income), 518.7);
    value(this.financialBand(financial.assets), 552.4);
    value(this.volumeBand(context.userData.totalVolumeChfAuditPeriod ?? 0), 609.5);

    const source = financial.source_of_funds;
    [633.2, 647.3, 661.4, 689.6, 703.8].forEach((top) => this.uncheck(first, 267.2, top));
    if (source === 'business' || financial.occupation === 'self_employed' || financial.occupation === 'inhaber')
      this.check(first, 267.2, 633.2);
    if (source === 'business') this.check(first, 267.2, 647.3);
    if (source === 'real_estate_sale') this.check(first, 267.2, 661.4);
    if (source === 'OTHER') this.check(first, 267.2, 703.8);
    if ((context.userData.totalVolumeChfAuditPeriod ?? 0) > 100000)
      value("Siehe eigene Aktennotiz bezüglich Freigabe Handelsvolumen > 100'000 CHF", 722.0, 36);

    const second = pdf.getPage(1);
    this.uncheck(second, 282.2, 167.5);
    this.uncheck(second, 282.2, 197.1);
    if (context.userData.sellVolume > 0) this.check(second, 282.2, 167.5);
    if (context.userData.cryptoVolume > 0) this.check(second, 282.2, 197.1);
  }

  private renderRiskProfile(pdf: PDFDocument, fonts: PdfFonts, context: DfxApprovalPdfContext): void {
    const first = pdf.getPage(0);
    this.text(first, fonts, context.userData.id, {
      x: 430.9,
      top: 79.6,
      width: 125,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.text(first, fonts, context.userData.verifiedName, {
      x: 135.9,
      top: 265.7,
      width: 420,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.text(first, fonts, this.timestamp(context.userData.amlListAddedDate), {
      x: 135.9,
      top: 347.9,
      width: 420,
      color: BLUE,
      bold: true,
      size: 9,
    });
    this.booleanChecks(first, !context.userData.pep, 514.4, 529.2);
    this.booleanChecks(first, !context.userData.pep, 592.8, 606.3);

    const second = pdf.getPage(1);
    this.booleanChecks(second, context.userData.highRisk === false, 150.0, 166.7);
    this.booleanChecks(second, context.userData.complexOrgStructure === false, 301.0, 316.5);
    const normalCountry = context.userData.country?.fatfEnable === true;
    this.booleanChecks(second, normalCountry, 455.6, 471.7);
    this.booleanChecks(second, normalCountry, 503.8, 519.9);
    this.booleanChecks(second, normalCountry, 568.1, 584.2);
    this.booleanChecks(second, context.userData.highRisk === false, 677.4, 693.5);

    const third = pdf.getPage(2);
    this.booleanChecks(third, normalCountry, 134.6, 166.7);
    this.booleanChecks(third, context.userData.highRisk === false, 313.0, 329.1);
  }

  private booleanChecks(page: PDFPage, positive: boolean, positiveTop: number, negativeTop: number): void {
    this.uncheck(page, 259.4, positiveTop);
    this.uncheck(page, 259.4, negativeTop);
    this.check(page, 259.4, positive ? positiveTop : negativeTop);
  }

  private text(page: PDFPage, fonts: PdfFonts, raw: unknown, options: TextOptions): void {
    if (raw == null || raw === '') return;
    const value = String(raw)
      .split(/\r?\n/)
      .map((line) => line.replace(/[\t ]+/g, ' ').trim())
      .join('\n')
      .trim();
    if (!value) return;
    const font = options.bold ? fonts.bold : fonts.regular;
    const size = options.size ?? 8.5;
    const width = options.width ?? 260;
    const lineHeight = size * 1.12;
    const maxLines = Math.max(1, Math.floor((options.height ?? lineHeight) / lineHeight));
    const lines = value
      .split('\n')
      .flatMap((line) => this.wrap(line, font, size, width, maxLines))
      .slice(0, maxLines);

    // A value that does not fit its field is cut off; saying so turns a silently incomplete GwG
    // document into a visible one.
    const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
    if (collapse(lines.join(' ')) !== collapse(value))
      this.logger.warn(`DfxApproval document: a value did not fit its field and was truncated`);
    lines.forEach((line, index) => {
      page.drawText(this.encodable(line, fonts), {
        x: options.x,
        y: page.getHeight() - options.top - size - index * lineHeight + 1.5,
        size,
        font,
        color: options.color ?? BLACK,
      });
    });
  }

  private wrap(value: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
    const words = value.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
        if (lines.length === maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(this.fit(current, font, size, width));
    return lines.slice(0, maxLines);
  }

  private fit(value: string, font: PDFFont, size: number, width: number): string {
    let result = value;
    while (result && font.widthOfTextAtSize(result, size) > width) result = result.slice(0, -1);
    return result;
  }

  // The font files are read once per process; each document embeds only the glyphs it uses.
  private async embedFonts(pdf: PDFDocument): Promise<PdfFonts> {
    this.fontFiles ??= Promise.all([
      readFile(join(__dirname, FONT_DIRECTORY, REGULAR_FONT_FILE)),
      readFile(join(__dirname, FONT_DIRECTORY, BOLD_FONT_FILE)),
    ]);
    const [regularFile, boldFile] = await this.fontFiles;

    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(regularFile, { subset: true });
    const bold = await pdf.embedFont(boldFile, { subset: true });

    return { regular, bold, encodable: new Set(regular.getCharacterSet()) };
  }

  // Characters the font has no glyph for (e.g. CJK) are replaced instead of failing the document:
  // a document with one substituted character is worth more than no document at all.
  private encodable(value: string, fonts: PdfFonts): string {
    return Array.from(value)
      .map((character) => (fonts.encodable.has(character.codePointAt(0) ?? 0) ? character : REPLACEMENT_CHARACTER))
      .join('');
  }

  private check(page: PDFPage, x: number, top: number): void {
    const size = 12;
    const y = page.getHeight() - top - size;
    page.drawRectangle({ x, y, width: size, height: size, color: BLUE, borderColor: BLUE, borderWidth: 0.8 });
    page.drawLine({ start: { x: x + 2.2, y: y + 6.2 }, end: { x: x + 5, y: y + 3.2 }, color: WHITE, thickness: 1.6 });
    page.drawLine({ start: { x: x + 4.8, y: y + 3.2 }, end: { x: x + 10, y: y + 9.4 }, color: WHITE, thickness: 1.6 });
  }

  private uncheck(page: PDFPage, x: number, top: number): void {
    const size = 12;
    const y = page.getHeight() - top - size;
    page.drawRectangle({ x, y, width: size, height: size, color: WHITE, borderColor: BLUE, borderWidth: 0.8 });
  }

  private financialData(steps: KycStep[]): FinancialData {
    const financialStep = steps
      .filter((step) => step.name === KycStepName.FINANCIAL_DATA && step.isCompleted)
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
    if (!financialStep?.result) throw new Error('Completed FinancialData result is missing');

    let responses: KycFinancialResponse[];
    try {
      responses = JSON.parse(financialStep.result) as KycFinancialResponse[];
    } catch (error) {
      throw new Error(`FinancialData result is invalid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(responses) || responses.some((response) => !response?.key || !response?.value))
      throw new Error('FinancialData result has an invalid structure');
    return Object.fromEntries(responses.map((response) => [response.key, response.value]));
  }

  private employment(financial: FinancialData): string {
    const occupation = financial.occupation === 'self_employed' ? 'Selbständig' : financial.occupation;
    return [
      occupation && `Beruf: ${occupation}`,
      financial.occupation_description && `Arbeitgeber: ${financial.occupation_description}`,
      financial.sector && `Branche: ${financial.sector}`,
    ]
      .filter(Boolean)
      .join('\n')
      .replace(/n\.a\./g, '');
  }

  private financialBand(value?: string): string {
    if (value && !(value in FINANCIAL_BANDS))
      this.logger.warn(`DfxApproval CustomerProfile: unknown FinancialData band '${value}', left empty`);

    return FINANCIAL_BANDS[value ?? ''] ?? '';
  }

  private volumeBand(volume: number): string {
    if (volume <= 100000) return "zwischen 0 und 100'000 CHF";
    if (volume <= 500000) return "zwischen 100'000 und 500'000 CHF";
    if (volume <= 1000000) return "zwischen 500'000 und 1'000'000 CHF";
    if (volume <= 5000000) return "zwischen 1'000'000 und 5'000'000 CHF";
    if (volume <= 10000000) return "zwischen 5'000'000 und 10'000'000 CHF";
    if (volume <= 15000000) return "zwischen 10'000'000 und 15'000'000 CHF";
    return "grösser 15'000'000 CHF";
  }

  private nameCheckResult(nameCheck: NameCheckLog): string {
    try {
      const result = JSON.parse(nameCheck.result) as { total_hits?: number };
      if (result.total_hits === 0) return 'keine Treffer gefunden';
    } catch {
      // The productive Sheet leaves the result field empty when the raw result cannot be parsed.
    }
    return nameCheck.riskStatus === NameCheckRiskStatus.NOT_SANCTIONED ? 'keine Treffer gefunden' : '';
  }

  private requiredNameCheck(context: DfxApprovalPdfContext): NameCheckLog {
    if (!context.nameCheck) throw new Error('NameCheck evidence is missing');
    return context.nameCheck;
  }

  private documentNumber(subType: FileSubType, context: DfxApprovalPdfContext): string {
    return (context.documentName ?? this.fileName(subType, context)).replace(/\.pdf$/, '');
  }

  private address(userData: UserData): string {
    return [
      [userData.street, userData.houseNumber].filter(Boolean).join(' '),
      [userData.zip, userData.location].filter(Boolean).join(' '),
      userData.country?.name,
    ]
      .filter(Boolean)
      .join(', ');
  }

  private date(value?: Date): string {
    if (!value) return '';
    return new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich' }).format(value);
  }

  private timestamp(value?: Date): string {
    if (!value) return '';
    const parts = this.zurichParts(value);
    return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  private compactDate(value?: Date): string {
    if (!value) throw new Error('Document date is missing');
    const parts = this.zurichParts(value);
    return `${parts.year}${parts.month}${parts.day}`;
  }

  private compactTime(value: Date): string {
    const parts = this.zurichParts(value);
    return `${parts.hour}${parts.minute}${parts.second}`;
  }

  private zurichParts(value: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<
      'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
      string
    >;
  }
}
