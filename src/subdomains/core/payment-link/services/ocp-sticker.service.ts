import { Injectable, UnauthorizedException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { I18nService } from 'nestjs-i18n';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { SellService } from '../../sell-crypto/route/sell.service';
import { PaymentLink } from '../entities/payment-link.entity';
import { StickerQrMode, StickerType } from '../enums';
import { PaymentLinkService } from './payment-link.service';

@Injectable()
export class OCPStickerService {
  constructor(
    private readonly sellService: SellService,
    private readonly i18n: I18nService,
    private readonly paymentLinkService: PaymentLinkService,
  ) {}

  async generateOcpStickersPdf(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
    type = StickerType.BITCOIN_FOCUS,
    lang = 'en',
    mode = StickerQrMode.PAYMENT_LINK,
    userId?: number,
  ): Promise<Buffer> {
    if (type === StickerType.BITCOIN_FOCUS) {
      return this.generateBitcoinFocusStickersPdf(routeIdOrLabel, externalIds, ids, lang, mode, userId);
    } else {
      return this.generateClassicStickersPdf(routeIdOrLabel, externalIds, ids, lang, mode, userId);
    }
  }

  private async generateClassicStickersPdf(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
    lang = 'en',
    mode = StickerQrMode.PAYMENT_LINK,
    userId?: number,
  ): Promise<Buffer> {
    const links = await this.fetchPaymentLinks(routeIdOrLabel, externalIds, ids);

    let posUrls: Map<string, string> = new Map();
    if (mode === StickerQrMode.POS) {
      if (!userId) throw new UnauthorizedException('User ID required for POS mode');

      for (const link of links) {
        const posUrl = await this.paymentLinkService.createPosLinkUser(userId, link.id, link.externalId, undefined);
        posUrls.set(link.uniqueId, posUrl);
      }
    }

    // Translated sticker title
    const stickerTitle = this.i18n.translate(
      mode === StickerQrMode.POS ? 'payment.sticker.payment_activation' : 'payment.sticker.pay_with_crypto',
      { lang: lang.toLowerCase() },
    );

    // Classic (blue) OCP Sticker
    const stickerPath = join(process.cwd(), 'assets', 'ocp-classic-sticker.png');
    const stickerBuffer = readFileSync(stickerPath);

    // OCP Logo
    const ocpLogoPath = join(process.cwd(), 'assets', 'ocp_logo.png');
    const ocpLogoBuffer = readFileSync(ocpLogoPath);

    const qrPadding = 10;
    const borderWidth = 2.7;
    const borderColor = '#2130EE'; // #2130EE
    const cols = 2;
    const rows = 6;
    const margin = 30;
    const stickerSpacing = 20;
    const ocpLogoSize = 35;
    const ocpLogoBgPadding = 5; // Padding for white background

    const imgAspect = 1;
    const ratioSum = imgAspect + 1;

    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A3', margin: 0 });
        const chunks: Buffer[] = [];
        pdf.on('data', (c) => chunks.push(c));
        pdf.on('end', () => resolve(Buffer.concat(chunks)));

        const { width: pageWidth, height: pageHeight } = pdf.page;
        const availW = pageWidth - 2 * margin;
        const availH = pageHeight - 2 * margin;

        const byH = (availH - (rows - 1) * stickerSpacing) / rows;
        const byW = (availW - (cols - 1) * stickerSpacing) / cols / ratioSum;

        const stickerHeight = Math.min(byH, byW);
        const pngWidth = stickerHeight * imgAspect;
        const qrWidth = stickerHeight;
        const stickerWidth = pngWidth + qrWidth;

        const gridW = cols * stickerWidth + (cols - 1) * stickerSpacing;
        const gridH = rows * stickerHeight + (rows - 1) * stickerSpacing;

        const startX = margin + (availW - gridW) / 2;
        const startY = margin + (availH - gridH) / 2;

        const stickersPerPage = cols * rows;
        for (let i = 0; i < links.length; i++) {
          if (i > 0 && i % stickersPerPage === 0) {
            pdf.addPage();
          }

          const { externalId, id, uniqueId } = links[i];
          const idx = i % stickersPerPage;
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const x = startX + col * (stickerWidth + stickerSpacing);
          const y = startY + row * (stickerHeight + stickerSpacing);

          // Generate QR code URL based on mode
          let qrCodeUrl: string;
          if (mode === StickerQrMode.POS) {
            qrCodeUrl = posUrls.get(uniqueId);
          } else {
            const lnurl = LightningHelper.createEncodedLnurlp(uniqueId);
            qrCodeUrl = `${Config.frontend.services}/pl?lightning=${lnurl}`;
          }
          const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
            width: 400,
            margin: 0,
          });
          const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');

          // Add Classic (blue) OCP Sticker
          pdf.image(stickerBuffer, x, y, { width: pngWidth, height: stickerHeight + 1 });

          // Add QR-Code
          pdf.image(qrBuffer, x + pngWidth + qrPadding, y + qrPadding, {
            width: qrWidth - qrPadding * 2,
            height: stickerHeight - qrPadding * 2,
          });

          // Add white background for OCP Logo
          const logoHeight = ocpLogoSize / 1.333;
          const logoX = x + pngWidth + qrPadding + (qrWidth - qrPadding * 2 - ocpLogoSize) / 2;
          const logoY = y + qrPadding + (stickerHeight - qrPadding * 2 - logoHeight) / 2;

          pdf.fillColor('white');
          pdf
            .rect(
              logoX - ocpLogoBgPadding,
              logoY - ocpLogoBgPadding,
              ocpLogoSize + 2 * ocpLogoBgPadding,
              logoHeight + 2 * ocpLogoBgPadding,
            )
            .fill();

          // Add OCP Logo
          pdf.image(ocpLogoBuffer, logoX, logoY, {
            width: ocpLogoSize,
            height: logoHeight,
          });

          // Add title
          pdf.fontSize(10).font('Helvetica').fillColor('white');
          const labelX = x + 12;
          const labelY = y + 8;
          pdf.text(stickerTitle, labelX, labelY);

          // Add External ID
          this.drawExternalId(pdf, externalId ?? id.toString(), x + pngWidth - 5, y + stickerHeight - 7);

          // Add Border
          pdf
            .strokeColor(borderColor)
            .lineWidth(borderWidth)
            .rect(x + 1, y, stickerWidth, stickerHeight)
            .stroke();
        }

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private async generateBitcoinFocusStickersPdf(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
    lang = 'en',
    mode = StickerQrMode.PAYMENT_LINK,
    userId?: number,
  ): Promise<Buffer> {
    const links = await this.fetchPaymentLinks(routeIdOrLabel, externalIds, ids);

    let posUrls: Map<string, string> = new Map();
    if (mode === StickerQrMode.POS) {
      if (!userId) throw new UnauthorizedException('User ID required for POS mode');

      for (const link of links) {
        const posUrl = await this.paymentLinkService.createPosLinkUser(userId, link.id, link.externalId, undefined);
        posUrls.set(link.uniqueId, posUrl);
      }
    }

    // Bitcoin Focus OCP Sticker
    const stickerFileName =
      mode === StickerQrMode.POS
        ? `ocp-bitcoin-focus-sticker-pos_${lang.toLowerCase()}.png`
        : `ocp-bitcoin-focus-sticker_${lang.toLowerCase()}.png`;
    const stickerPath = join(process.cwd(), 'assets', stickerFileName);
    const stickerBuffer = readFileSync(stickerPath);

    // OCP Logo
    const ocpLogoPath = join(process.cwd(), 'assets', 'ocp_logo.png');
    const ocpLogoBuffer = readFileSync(ocpLogoPath);

    const cols = 2;
    const rows = 6;
    const margin = 30;
    const stickerSpacing = 20;
    const qrPadding = 10;
    const ocpLogoSize = 20;
    const ocpLogoBgPadding = 4;
    const stickerAspect = 1.62654522; // width / height ratio of the sticker image
    const ocpLogoAspect = 1.31590909; // width / height ratio of the OCP logo
    const leftPartition = 0.532; // Left partition of the sticker

    return new Promise<Buffer>(async (resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A3', margin: 0 });
        const chunks: Buffer[] = [];
        pdf.on('data', (c) => chunks.push(c));
        pdf.on('end', () => resolve(Buffer.concat(chunks)));

        const { width: pageWidth, height: pageHeight } = pdf.page;
        const availW = pageWidth - 2 * margin;
        const availH = pageHeight - 2 * margin;

        const byH = (availH - (rows - 1) * stickerSpacing) / rows;
        const byW = (availW - (cols - 1) * stickerSpacing) / cols / stickerAspect;

        const stickerHeight = Math.min(byH, byW);
        const stickerWidth = stickerHeight * stickerAspect;
        const qrAreaWidth = stickerWidth * (1 - leftPartition);
        const qrWidth = qrAreaWidth - 2 * qrPadding;

        const gridW = cols * stickerWidth + (cols - 1) * stickerSpacing;
        const gridH = rows * stickerHeight + (rows - 1) * stickerSpacing;

        const startX = margin + (availW - gridW) / 2;
        const startY = margin + (availH - gridH) / 2;

        const stickersPerPage = cols * rows;
        for (let i = 0; i < links.length; i++) {
          if (i > 0 && i % stickersPerPage === 0) {
            pdf.addPage();
          }

          const { externalId, id, uniqueId } = links[i];
          const idx = i % stickersPerPage;
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const x = startX + col * (stickerWidth + stickerSpacing);
          const y = startY + row * (stickerHeight + stickerSpacing);

          // Generate QR code URL based on mode
          let qrCodeUrl: string;
          if (mode === StickerQrMode.POS) {
            qrCodeUrl = posUrls.get(uniqueId);
          } else {
            const lnurl = LightningHelper.createEncodedLnurlp(uniqueId);
            qrCodeUrl = `${Config.frontend.services}/pl?lightning=${lnurl}`;
          }

          // Generate QR code matrix data
          const qrData = QRCode.create(qrCodeUrl, {});
          const moduleCount = qrData.modules.size;
          const moduleSize = qrWidth / moduleCount;
          const dotRadius = moduleSize * 0.5; // Radius for QR code dots

          // Add Bitcoin Focus OCP Sticker
          pdf.image(stickerBuffer, x, y, { width: stickerWidth, height: stickerHeight });

          // Draw white background for QR code area
          pdf.rect(x + stickerWidth - qrAreaWidth + qrPadding, y + qrPadding, qrWidth, qrWidth).fill('white');

          // Calculate logo position
          const logoHeight = ocpLogoSize / ocpLogoAspect;
          const logoX = x + stickerWidth - qrAreaWidth + qrPadding + (qrWidth - ocpLogoSize) / 2;
          const logoY = y + qrPadding + (qrWidth - logoHeight) / 2;
          const logoCenterX = logoX + ocpLogoSize / 2;
          const logoCenterY = logoY + logoHeight / 2;
          const logoRadius = ocpLogoSize / 2 + ocpLogoBgPadding;

          // Draw QR code dots (excluding finder patterns and logo area)
          pdf.fillColor('black');
          for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
              if (qrData.modules.get(row, col) && !this.isInFinderPattern(row, col, moduleCount)) {
                const centerX = x + stickerWidth - qrAreaWidth + qrPadding + col * moduleSize + moduleSize / 2;
                const centerY = y + qrPadding + row * moduleSize + moduleSize / 2;
                if (!this.isInLogoArea(centerX, centerY, logoCenterX, logoCenterY, logoRadius)) {
                  pdf.circle(centerX, centerY, dotRadius).fill();
                }
              }
            }
          }

          // Draw finder patterns as rounded squares
          const qrStartX = x + stickerWidth - qrAreaWidth + qrPadding;
          const qrStartY = y + qrPadding;

          // Draw the three finder patterns
          this.drawFinderPattern(pdf, 0, 0, qrStartX, qrStartY, moduleSize); // TL corner
          this.drawFinderPattern(pdf, (moduleCount - 7) * moduleSize, 0, qrStartX, qrStartY, moduleSize); // TR corner
          this.drawFinderPattern(pdf, 0, (moduleCount - 7) * moduleSize, qrStartX, qrStartY, moduleSize); // BL corner

          // Add OCP Logo
          pdf.image(ocpLogoBuffer, logoX, logoY, {
            width: ocpLogoSize,
            height: logoHeight,
          });

          // Add External ID
          this.drawExternalId(
            pdf,
            externalId ?? id.toString(),
            x + stickerWidth * leftPartition - 5,
            y + stickerHeight - 7,
          );
        }

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  // Helper functions

  private async fetchPaymentLinks(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
  ): Promise<PaymentLink[]> {
    const linksFromDb = await this.sellService.getPaymentLinksFromRoute(routeIdOrLabel, externalIds, ids);
    const linkMapByExternalId = new Map(linksFromDb.map((link) => [link.externalId, link]));
    const linkMapById = new Map(linksFromDb.map((link) => [link.id, link]));
    const linksByExternalId = externalIds?.map((extId) => linkMapByExternalId.get(extId)).filter(Boolean) || [];
    const linksById = ids?.map((id) => linkMapById.get(id)).filter(Boolean) || [];
    return [...linksByExternalId, ...linksById];
  }

  private drawExternalId(pdf: InstanceType<typeof PDFDocument>, text: string, x: number, y: number): void {
    pdf.fontSize(4).font('Helvetica').fillColor('black');
    const textWidth = pdf.widthOfString(text);
    pdf.text(text, x - textWidth, y);
  }

  private isInFinderPattern(row: number, col: number, moduleCount: number): boolean {
    if (row < 7 && col < 7) return true; // TL corner
    if (row < 7 && col >= moduleCount - 7) return true; // TR corner
    if (row >= moduleCount - 7 && col < 7) return true; // BL corner
    return false;
  }

  private isInLogoArea(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
    const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
    return distance < radius;
  }

  private drawFinderPattern(
    pdf: InstanceType<typeof PDFDocument>,
    patternX: number,
    patternY: number,
    qrStartX: number,
    qrStartY: number,
    moduleSize: number,
  ): void {
    const baseX = qrStartX + patternX;
    const baseY = qrStartY + patternY;
    // Outer black rounded square (7x7 modules)
    pdf.fillColor('black');
    pdf.roundedRect(baseX, baseY, moduleSize * 7, moduleSize * 7, moduleSize * 2.5).fill();
    // Middle white rounded square (5x5 modules)
    pdf.fillColor('white');
    pdf.roundedRect(baseX + moduleSize, baseY + moduleSize, moduleSize * 5, moduleSize * 5, moduleSize * 1.8).fill();
    // Inner black rounded square (3x3 modules)
    pdf.fillColor('black');
    pdf
      .roundedRect(baseX + moduleSize * 2, baseY + moduleSize * 2, moduleSize * 3, moduleSize * 3, moduleSize * 1.0)
      .fill();
  }
}
