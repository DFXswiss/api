import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';
import { ScorechainScreening } from '../entities/scorechain-screening.entity';

// Parsed shape of ScorechainScreening.riskIndicatorData (the persisted `analysis` object). Kept
// permissive/local to the renderer — the provider payload is only ever read here for display.
interface ScorechainAnalysisDetail {
  name?: string;
  type?: string;
  countries?: string[];
  percentage?: number;
  amountUsd?: number;
  score?: number;
  severity?: string;
}

interface ScorechainAnalysisSection {
  hasResult?: boolean;
  result?: {
    score?: number;
    severity?: string;
    details?: ScorechainAnalysisDetail[];
  } | null;
}

type ScorechainAnalysisKey = 'assigned' | 'incoming' | 'outgoing' | 'full';
type ScorechainAnalysisData = Partial<Record<ScorechainAnalysisKey, ScorechainAnalysisSection>>;

const SECTION_LABELS: Record<ScorechainAnalysisKey, string> = {
  assigned: 'Assigned exposure',
  incoming: 'Incoming exposure',
  outgoing: 'Outgoing exposure',
  full: 'Full analysis',
};

const MARGIN_X = 50;
const MAX_DETAIL_ROWS = 15;

@Injectable()
export class ScorechainPdfService {
  // Renders the screening verdict as a one-page compliance report and returns the raw PDF buffer.
  // Async by necessity: pdfkit is a Readable stream whose chunks are only flushed to the collector
  // once flowing (deferred to the `end` event), so the buffer must be resolved there — mirrors every
  // other DFX pdfkit service (see custody-pdf.service).
  async generate(screening: ScorechainScreening): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: MARGIN_X });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks)));

        PdfUtil.drawLogo(pdf, PdfBrand.DFX, LogoSize.SMALL);
        this.drawHeader(pdf, screening);
        this.drawVerdict(pdf, screening);
        this.drawBreakdown(pdf, screening);
        this.drawFooter(pdf);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawHeader(pdf: InstanceType<typeof PDFDocument>, screening: ScorechainScreening): void {
    const { width } = pdf.page;

    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
    pdf.text('Scorechain Risk Screening', MARGIN_X, 75);

    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const contentWidth = width - MARGIN_X * 2;
    let y = 105;
    pdf.text(`Address: ${screening.objectId}`, MARGIN_X, y, { width: contentWidth });
    y += 18;
    pdf.text(`Blockchain: ${screening.blockchain}`, MARGIN_X, y, { width: contentWidth });
    y += 18;
    pdf.text(`Object type: ${screening.objectType}`, MARGIN_X, y, { width: contentWidth });
    y += 18;
    pdf.text(`Context: ${screening.context}`, MARGIN_X, y, { width: contentWidth });
    y += 18;

    y += 4;
    pdf
      .moveTo(MARGIN_X, y)
      .lineTo(width - MARGIN_X, y)
      .stroke('#072440');
    pdf.y = y + 15;
  }

  private drawVerdict(pdf: InstanceType<typeof PDFDocument>, screening: ScorechainScreening): void {
    const { width } = pdf.page;
    let y = pdf.y;

    pdf.fontSize(13).font('Helvetica-Bold').fillColor('#072440');
    pdf.text('Verdict', MARGIN_X, y);
    y += 22;

    pdf.fontSize(11).font('Helvetica').fillColor('#333333');
    pdf.text(
      `Risk score: ${screening.riskScore == null ? 'n/a' : `${screening.riskScore} / 100 (lower = riskier)`}`,
      MARGIN_X,
      y,
    );
    y += 18;
    pdf.text(`Severity: ${screening.severity ?? 'n/a'}`, MARGIN_X, y);
    y += 18;
    pdf.text(
      `Proof-of-authenticity ${screening.signatureValid ? 'verified' : 'NOT verified'}`,
      MARGIN_X,
      y,
    );
    y += 24;

    pdf
      .moveTo(MARGIN_X, y)
      .lineTo(width - MARGIN_X, y)
      .stroke('#CCCCCC');
    pdf.y = y + 15;
  }

  private drawBreakdown(pdf: InstanceType<typeof PDFDocument>, screening: ScorechainScreening): void {
    const analysis = screening.riskIndicatorData as ScorechainAnalysisData | undefined;

    const sections = (Object.keys(SECTION_LABELS) as ScorechainAnalysisKey[])
      .map((key) => ({ key, section: analysis?.[key] }))
      .filter((s) => s.section?.hasResult === true);

    if (sections.length === 0) {
      // NoCoverage / NotFound / NotSupported (or an empty analysis): nothing to tabulate.
      pdf.fontSize(11).font('Helvetica-Oblique').fillColor('#707070');
      pdf.text(
        'No risk-indicator breakdown available for this screening (no on-chain coverage, object not found, or chain not supported).',
        MARGIN_X,
        pdf.y,
        { width: pdf.page.width - MARGIN_X * 2 },
      );
      return;
    }

    for (const { key, section } of sections) {
      this.drawSection(pdf, SECTION_LABELS[key], section);
    }
  }

  private drawSection(
    pdf: InstanceType<typeof PDFDocument>,
    label: string,
    section: ScorechainAnalysisSection,
  ): void {
    const { width } = pdf.page;
    const tableWidth = width - MARGIN_X * 2;
    const cols = [
      { key: 'name', header: 'Entity', width: tableWidth * 0.34, align: 'left' as const },
      { key: 'type', header: 'Type', width: tableWidth * 0.16, align: 'left' as const },
      { key: 'percentage', header: 'Exposure %', width: tableWidth * 0.16, align: 'left' as const },
      { key: 'amountUsd', header: 'Amount USD', width: tableWidth * 0.19, align: 'left' as const },
      { key: 'score', header: 'Score', width: tableWidth * 0.15, align: 'right' as const },
    ];

    let y = this.ensureSpace(pdf, pdf.y, 60);

    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    const score = section.result?.score;
    const severity = section.result?.severity;
    pdf.text(
      `${label}${score == null ? '' : ` — score ${score}`}${severity ? ` (${severity})` : ''}`,
      MARGIN_X,
      y,
    );
    y += 20;

    // header row
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#072440');
    let x = MARGIN_X;
    for (const col of cols) {
      pdf.text(col.header, x, y, { width: col.width - 6, align: col.align });
      x += col.width;
    }
    y += 16;
    pdf
      .moveTo(MARGIN_X, y)
      .lineTo(width - MARGIN_X, y)
      .stroke('#CCCCCC');
    y += 8;

    const details = [...(section.result?.details ?? [])]
      .sort((a, b) => this.scoreForSort(a) - this.scoreForSort(b))
      .slice(0, MAX_DETAIL_ROWS);

    pdf.fontSize(10).font('Helvetica').fillColor('#333333');
    if (details.length === 0) {
      pdf.text('No detail entries reported.', MARGIN_X, y, { width: tableWidth });
      y += 18;
    } else {
      for (const detail of details) {
        y = this.ensureSpace(pdf, y, 22);
        pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        const values: Record<string, string> = {
          name: detail.name ?? 'n/a',
          type: detail.type ?? 'n/a',
          percentage: detail.percentage == null ? 'n/a' : `${detail.percentage.toFixed(2)}%`,
          amountUsd: this.formatUsd(detail.amountUsd),
          score: detail.score == null ? 'n/a' : `${detail.score}`,
        };
        x = MARGIN_X;
        for (const col of cols) {
          pdf.text(values[col.key], x, y, { width: col.width - 6, align: col.align });
          x += col.width;
        }
        y += 18;
      }
    }

    y += 10;
    pdf.y = y;
  }

  private drawFooter(pdf: InstanceType<typeof PDFDocument>): void {
    const y = this.ensureSpace(pdf, pdf.y + 10, 30);
    pdf.fontSize(8).font('Helvetica').fillColor('#999999');
    pdf.text(`Generated by DFX - ${new Date().toISOString()}`, MARGIN_X, y);
  }

  // --- HELPERS --- //

  private ensureSpace(pdf: InstanceType<typeof PDFDocument>, y: number, needed: number): number {
    if (y + needed > pdf.page.height - 50) {
      pdf.addPage();
      return 50;
    }
    return y;
  }

  private scoreForSort(detail: ScorechainAnalysisDetail): number {
    return detail.score == null ? Number.POSITIVE_INFINITY : detail.score;
  }

  private formatUsd(value?: number): string {
    if (value == null) return 'n/a';
    return `$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
