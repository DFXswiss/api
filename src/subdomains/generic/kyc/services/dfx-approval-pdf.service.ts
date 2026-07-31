import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { KycFinancialResponse } from '../dto/input/kyc-financial-in.dto';
import { FileSubType } from '../dto/kyc-file.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../entities/name-check-log.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';

type Pdf = InstanceType<typeof PDFDocument>;
type FinancialData = Record<string, string>;

export interface DfxApprovalPdfContext {
  userData: UserData;
  steps: KycStep[];
  nameCheck: NameCheckLog;
  generatedAt: Date;
}

const MEMBER_NUMBER = '100919';
const FORM_VERSION = 'DFX API v1 / 31.07.2026';

@Injectable()
export class DfxApprovalPdfService {
  async generate(subType: FileSubType, context: DfxApprovalPdfContext): Promise<Buffer> {
    switch (subType) {
      case FileSubType.GWG_FILE_COVER:
        return this.createPdf((pdf) => this.renderCover(pdf, context));
      case FileSubType.IDENTIFICATION_FORM:
        return this.createPdf((pdf) => this.renderIdentificationForm(pdf, context));
      case FileSubType.CUSTOMER_PROFILE:
        return this.createPdf((pdf) => this.renderCustomerProfile(pdf, context));
      case FileSubType.RISK_PROFILE:
        return this.createPdf((pdf) => this.renderRiskProfile(pdf, context));
      case FileSubType.FORM_A:
        return this.createPdf((pdf) => this.renderFormA(pdf, context));
      case FileSubType.DFX_NAME_CHECK:
        return this.createPdf((pdf) => this.renderNameCheck(pdf, context));
      default:
        throw new Error(`Unsupported DfxApproval document subtype ${subType}`);
    }
  }

  private createPdf(render: (pdf: Pdf) => void): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 42, info: { Producer: 'DFX API' } });
        const chunks: Buffer[] = [];
        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks)));
        pdf.on('error', reject);
        render(pdf);
        pdf.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private renderCover(pdf: Pdf, context: DfxApprovalPdfContext): void {
    this.header(pdf, 'GwG-File', context);
    this.fields(pdf, [
      ['User Data ID', context.userData.id],
      ['DFX Dokument Nr.', this.documentNumber(context, FileSubType.GWG_FILE_COVER)],
      ['Timestamp Dokument', context.generatedAt.toISOString()],
      ['Art der Gegenpartei', 'Privatperson'],
      ['Kunde', context.userData.completeName],
      ['Konversationspartner', context.userData.naturalPersonName],
      ['Status der Geschäftsbeziehung', 'aktiv'],
    ]);
    this.footer(pdf);
  }

  private renderNameCheck(pdf: Pdf, context: DfxApprovalPdfContext): void {
    this.header(pdf, 'NameCheck Sanktions- und PEP-Prüfung', context);
    this.fields(pdf, [
      ['User Data ID', context.userData.id],
      ['DFX Dokument Nr.', this.documentNumber(context, FileSubType.DFX_NAME_CHECK)],
      ['Timestamp Dokument', context.generatedAt.toISOString()],
      ['Art der Gegenpartei', 'Privatperson'],
      ['Kunde', context.userData.completeName],
    ]);
    this.section(pdf, 'Prüfnachweis');
    this.fields(pdf, [
      ['Prüfung durchgeführt mit', 'dilisense.com API'],
      ['Timestamp API-Abfrage', context.nameCheck.created?.toISOString()],
      ['Ergebnis', this.nameCheckResult(context.nameCheck)],
      ['Risikobewertung', context.nameCheck.riskStatus],
      ['RAW-Datei Original', context.nameCheck.result],
    ]);
    this.footer(pdf);
  }

  private renderFormA(pdf: Pdf, context: DfxApprovalPdfContext): void {
    this.header(pdf, 'Feststellung des wirtschaftlich Berechtigten (A)', context);
    this.fields(pdf, [
      ['Vertragspartner', context.userData.completeName],
      ['Name(n)', context.userData.surname],
      ['Vorname(n)', context.userData.firstname],
      ['Geburtsdatum', this.date(context.userData.birthday)],
      ['Nationalität', context.userData.nationality?.name],
      ['Effektive Wohnadresse', this.address(context.userData)],
    ]);
    this.paragraph(
      pdf,
      'Der Vertragspartner erklärt, dass er selbst allein an den in die Geschäftsbeziehung eingebrachten Vermögenswerten wirtschaftlich berechtigt ist. Änderungen sind DFX unaufgefordert mitzuteilen.',
    );
    this.section(pdf, 'Bestätigung');
    this.fields(pdf, [
      ['Bestätigt durch', 'Onboarding mit TAN-Verfahren'],
      ['Zeitpunkt', context.generatedAt.toISOString()],
      ['Datengrundlage', 'KYC-Schritte und unveränderbar gespeicherte Nachweise'],
    ]);
    this.paragraph(
      pdf,
      'Die vorsätzliche Angabe falscher Informationen kann eine strafbare Handlung darstellen. VQF Dok. Nr. 902.9; DFX-Fassung vom 1. Dezember 2023.',
    );
    this.footer(pdf);
  }

  private renderIdentificationForm(pdf: Pdf, context: DfxApprovalPdfContext): void {
    this.header(pdf, 'Identifizierungsformular', context);
    this.section(pdf, '1. Angaben zur Vertragspartei');
    this.fields(pdf, [
      ['Vorname/Nachname', context.userData.naturalPersonName],
      ['Wohnsitzadresse', this.address(context.userData)],
      ['Telefon', context.userData.phone],
      ['Mail', context.userData.mail],
      ['Geburtsdatum', this.date(context.userData.birthday)],
      ['Staatsangehörigkeit', context.userData.nationality?.name],
      ['Identifizierungsdokument', context.userData.identDocumentType],
      ['Dokumentnummer', context.userData.identDocumentId],
      ['Kopie im Anhang', 'Ja'],
    ]);
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.1');

    pdf.addPage();
    this.pageTitle(pdf, 'Identifizierungsformular – Fortsetzung');
    this.section(pdf, '2. Eröffner für juristische Personen');
    this.paragraph(pdf, 'Nicht anwendbar: Die Vertragspartei ist eine natürliche Person.');
    this.section(pdf, '3. Aufnahme der Geschäftsbeziehung');
    this.fields(pdf, [
      ['Datum (Vertragsschluss)', this.date(context.generatedAt)],
      ['Aufnahme durch', this.identificationMethod(context.userData.identificationType)],
      ['Art der Korrespondenzzustellung', 'elektronisch'],
      ['Sprache', context.userData.language?.name],
    ]);
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.1');

    pdf.addPage();
    this.pageTitle(pdf, 'Identifizierungsformular – Fortsetzung');
    this.section(pdf, '4. Wirtschaftlich berechtigte Person / Kontrollinhaber');
    this.check(pdf, true, 'Natürliche Person; wirtschaftliche Berechtigung bei der Vertragspartei selbst');
    this.check(pdf, false, 'Juristische Person oder Personengesellschaft');
    this.section(pdf, '5. Embargomassnahmen / Terrorismuslisten');
    this.paragraph(
      pdf,
      `Die Vertragspartei wurde über die Dilisense-Sanktions- und PEP-Prüfung geprüft. Ergebnis: ${this.nameCheckResult(context.nameCheck)}. Der Einzelnachweis ist als DfxNameCheck und PersonalNameCheck gespeichert.`,
    );
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.1');

    pdf.addPage();
    this.pageTitle(pdf, 'Identifizierungsformular – Fortsetzung');
    this.section(pdf, '6. Art und Zweck der Geschäftsbeziehung');
    this.check(pdf, true, 'Geldwechsel');
    this.check(pdf, true, 'Geldwechsel von Fiat-Währungen zu digitalen Vermögenswerten');
    this.check(pdf, true, 'Geldwechsel zwischen digitalen Vermögenswerten');
    this.section(pdf, '7. Beilagen');
    for (const label of [
      'Identifizierungsdokument',
      'Feststellung des wirtschaftlich Berechtigten (Formular A)',
      'Kundenprofil',
      'Risikoprofil',
      'NameCheck-Nachweise',
    ])
      this.check(pdf, true, label);
    this.paragraph(pdf, 'Bei einer Änderung der Verhältnisse ist das Formular zu aktualisieren.');
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.1');
  }

  private renderCustomerProfile(pdf: Pdf, context: DfxApprovalPdfContext): void {
    const financial = this.financialData(context.steps);
    this.header(pdf, 'Kundenprofil', context);
    this.paragraph(pdf, 'Für dauernde Geschäftsbeziehungen und Stammkunden.');
    this.fields(pdf, [
      ['Vertragspartei', context.userData.completeName],
      ['Beruf / geschäftliche Aktivität', financial.occupation],
      ['Beschreibung Arbeitgeber / Tätigkeit', financial.occupation_description],
      ['Branche', financial.sector],
      ['Jährliches Einkommen', financial.income],
      ['Vermögen', financial.assets],
      ['Herkunft der Vermögenswerte', financial.source_of_funds],
      ['Geplantes Handelsvolumen in CHF', financial.income],
    ]);
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.5');

    pdf.addPage();
    this.pageTitle(pdf, 'Kundenprofil – Fortsetzung');
    this.section(pdf, 'Art und Zweck der Geschäftsbeziehung');
    this.check(pdf, true, 'Geldwechsel');
    this.check(pdf, true, 'Geldwechsel von Fiat-Währungen zu digitalen Vermögenswerten');
    this.check(pdf, true, 'Geldwechsel zwischen digitalen Vermögenswerten');
    this.fields(pdf, [
      ['Entwicklung der Geschäftsbeziehung', 'Wachstum und weitere Investitionen nach Marktsituation'],
      ['Beziehung zu Dritten', 'Keine Angaben / keine Drittpartei aus den Onboarding-Daten'],
      ['Weitere Informationen', financial.risky_business],
    ]);
    this.paragraph(pdf, 'Bei einer Änderung der Verhältnisse ist das Kundenprofil zu aktualisieren.');
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.5');
  }

  private renderRiskProfile(pdf: Pdf, context: DfxApprovalPdfContext): void {
    this.header(pdf, 'Risikoprofil GwG', context);
    this.paragraph(
      pdf,
      'Ermittlung von Geschäftsbeziehungen mit erhöhtem Risiko und Festlegung von Kriterien zur Transaktionsüberwachung.',
    );
    this.section(pdf, '1. Politisch exponierte Personen (PEP)');
    this.check(pdf, context.userData.pep === false, 'Kein PEP-Hinweis');
    this.check(pdf, context.userData.pep === true, 'PEP-Hinweis vorhanden – automatische Freigabe unzulässig');
    this.fields(pdf, [['NameCheck-Nachweis', this.nameCheckResult(context.nameCheck)]]);
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.4');

    pdf.addPage();
    this.pageTitle(pdf, 'Risikoprofil GwG – Fortsetzung');
    this.section(pdf, '2. High-Risk- oder nicht kooperatives Land');
    this.check(pdf, context.userData.highRisk === false, 'Kein High-Risk-Merkmal in den Onboarding-Daten');
    this.check(pdf, context.userData.highRisk === true, 'High-Risk-Merkmal vorhanden');
    this.fields(pdf, [
      ['Wohnsitzland', context.userData.country?.name],
      ['Verifiziertes Land', context.userData.verifiedCountry?.name],
      ['Nationalität', context.userData.nationality?.name],
    ]);
    this.section(pdf, '3. Komplexe Struktur');
    this.check(pdf, context.userData.complexOrgStructure === false, 'Keine komplexe Organisationsstruktur');
    this.section(pdf, '4. Herkunft der Vermögenswerte');
    this.fields(pdf, Object.entries(this.financialData(context.steps)));
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.4');

    pdf.addPage();
    this.pageTitle(pdf, 'Risikoprofil GwG – Fortsetzung');
    this.section(pdf, '5. DFX-eigene Kriterien');
    this.paragraph(
      pdf,
      'Eine Blockchain-Analyse wird nicht pauschal als bestanden bescheinigt. Adressen und Transaktionen werden in den dafür vorgesehenen AML-Prozessen geprüft; deren Einzelnachweise bleiben separat erhalten.',
    );
    this.section(pdf, 'Gesamtbewertung');
    this.check(pdf, context.userData.highRisk === false, 'Geschäftsbeziehung ohne erhöhtes Onboarding-Risiko');
    this.check(pdf, context.userData.highRisk === true, 'Geschäftsbeziehung mit erhöhtem Risiko');
    this.section(pdf, '6. Transaktionsüberwachung');
    this.paragraph(
      pdf,
      'Reglementarische Schwellen, Länder- und Sanktionsrisiken sowie auffällige Transaktionsmuster werden durch die laufenden AML-Prüfungen bewertet. Dieses Dokument ersetzt keinen transaktionsbezogenen Prüfnachweis.',
    );
    this.paragraph(pdf, 'Bei einer Änderung der Verhältnisse ist das Risikoprofil zu aktualisieren.');
    this.formMeta(pdf, context, 'VQF Dok. Nr. 902.4');
  }

  private header(pdf: Pdf, title: string, context: DfxApprovalPdfContext): void {
    PdfUtil.drawLogo(pdf);
    pdf.moveDown(2.2).font('Helvetica-Bold').fontSize(19).fillColor('#072440').text(title);
    pdf.moveDown(0.7);
    this.fields(pdf, [
      ['VQF Mitglied Nr.', MEMBER_NUMBER],
      ['User Id.', context.userData.id],
      ['Erstellt', context.generatedAt.toISOString()],
    ]);
  }

  private pageTitle(pdf: Pdf, title: string): void {
    pdf.font('Helvetica-Bold').fontSize(16).fillColor('#072440').text(title).moveDown(1);
  }

  private section(pdf: Pdf, title: string): void {
    if (pdf.y > 720) pdf.addPage();
    pdf.moveDown(0.7).font('Helvetica-Bold').fontSize(12).fillColor('#072440').text(title).moveDown(0.35);
  }

  private fields(pdf: Pdf, rows: [string, unknown][]): void {
    for (const [label, rawValue] of rows) {
      const value = rawValue == null || rawValue === '' ? '–' : String(rawValue);
      if (pdf.y > 755) pdf.addPage();
      const y = pdf.y;
      pdf.font('Helvetica').fontSize(8.5).fillColor('#333333').text(label, 42, y, { width: 170 });
      pdf.font('Helvetica-Bold').fillColor('#0824d8').text(value, 215, y, { width: 335 });
      pdf.y = Math.max(pdf.y, y + 17);
      pdf
        .moveTo(42, pdf.y - 3)
        .lineTo(553, pdf.y - 3)
        .lineWidth(0.3)
        .stroke('#999999');
    }
  }

  private paragraph(pdf: Pdf, text: string): void {
    if (pdf.y > 700) pdf.addPage();
    pdf.moveDown(0.5).font('Helvetica').fontSize(9).fillColor('#222222').text(text, { align: 'left' }).moveDown(0.5);
  }

  private check(pdf: Pdf, checked: boolean, label: string): void {
    if (pdf.y > 755) pdf.addPage();
    const y = pdf.y;
    pdf.rect(44, y, 10, 10).lineWidth(1).stroke('#0824d8');
    if (checked)
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#0824d8')
        .text('X', 45, y - 1);
    pdf.font('Helvetica').fontSize(9).fillColor('#222222').text(label, 62, y, { width: 485 });
    pdf.y = Math.max(pdf.y, y + 17);
  }

  private formMeta(pdf: Pdf, context: DfxApprovalPdfContext, source: string): void {
    this.section(pdf, 'Dokumentation');
    this.fields(pdf, [
      ['Ausgefüllt / aktualisiert von', 'DFX API (automatisierter, regelgebundener Workflow)'],
      ['Zeitpunkt', context.generatedAt.toISOString()],
      ['Vorlage / Grundlage', `${source}; ${FORM_VERSION}`],
    ]);
    this.footer(pdf);
  }

  private footer(pdf: Pdf): void {
    pdf.font('Helvetica').fontSize(7).fillColor('#777777').text(FORM_VERSION, 42, 790, { width: 511 });
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

  private nameCheckResult(nameCheck: NameCheckLog): string {
    return nameCheck.riskStatus === NameCheckRiskStatus.NOT_SANCTIONED
      ? 'keine Treffer gefunden'
      : `Treffer vorhanden; Bewertung ${nameCheck.riskEvaluation ?? 'offen'}`;
  }

  private documentNumber(context: DfxApprovalPdfContext, subType: FileSubType): string {
    return `${Util.isoDate(context.generatedAt).replace(/-/g, '')}-${subType}-${context.userData.id}`;
  }

  private address(userData: UserData): string {
    return [userData.street, userData.houseNumber, userData.zip, userData.location, userData.country?.name]
      .filter(Boolean)
      .join(', ');
  }

  private date(value?: Date): string {
    return value ? Util.localeDataString(value, 'DE') : '–';
  }

  private identificationMethod(type?: string): string {
    if (type === KycIdentificationType.VIDEO_ID) return 'Online-Registrierung mittels Video-Identifikation';
    if (type === KycIdentificationType.MANUAL) return 'Persönliche / manuelle Identifikation';
    return 'Online-Registrierung mittels Online-Identifikation';
  }
}
