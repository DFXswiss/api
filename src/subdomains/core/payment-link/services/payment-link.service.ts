import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { I18nService } from 'nestjs-i18n';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { C2BPaymentLinkService } from 'src/integration/c2b-payment-link/c2b-payment-link.service';
import { C2BPaymentProvider } from 'src/integration/c2b-payment-link/share/providers.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { CountryService } from 'src/shared/models/country/country.service';
import { Util } from 'src/shared/utils/util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkConfigDto, UpdatePaymentLinkConfigDto } from '../dto/payment-link-config.dto';
import { PaymentLinkPayRequestDto, PaymentLinkPaymentErrorResponseDto } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto, UpdatePaymentLinkInternalDto } from '../dto/update-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus, PaymentStandard } from '../enums';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentLinkService {
  static readonly PREFIX_UNIQUE_ID = 'pl';

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly userDataService: UserDataService,
    private readonly countryService: CountryService,
    private readonly sellService: SellService,
    private readonly c2bPaymentLinkService: C2BPaymentLinkService,
    private readonly i18n: I18nService,
  ) {}

  async getOrThrow(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const link = await this.paymentLinkRepo.getPaymentLinkById(userId, linkId, externalLinkId, externalPaymentId);
    if (!link) throw new NotFoundException('Payment link not found');

    if (!link.payments) link.payments = [];

    const payment = externalPaymentId
      ? await this.paymentLinkPaymentService.getPaymentByExternalId(externalPaymentId)
      : await this.paymentLinkPaymentService.getMostRecentPayment(link.uniqueId);
    if (payment) link.payments.push(payment);

    return link;
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    const allPaymentLinks = await this.paymentLinkRepo.getAllPaymentLinks(userId);

    for (const paymentLink of allPaymentLinks) {
      if (!paymentLink.payments) paymentLink.payments = [];

      const mostRecentPayment = await this.paymentLinkPaymentService.getMostRecentPayment(paymentLink.uniqueId);
      if (mostRecentPayment) paymentLink.payments.push(mostRecentPayment);
    }

    return allPaymentLinks;
  }

  async getHistoryByStatus(userId: number, status?: string, from?: Date, to?: Date): Promise<PaymentLink[]> {
    const paymentStatus = status?.split(',').map((s) => Util.toEnum(PaymentLinkPaymentStatus, s)) ?? [
      PaymentLinkPaymentStatus.COMPLETED,
    ];

    const fromDate = from ?? Util.firstDayOfMonth();
    const toDate = to ?? Util.lastDayOfMonth();

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    return this.paymentLinkRepo.getHistoryByStatus(userId, paymentStatus, fromDate, toDate);
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.route
      ? await this.sellService.getByLabel(userId, dto.route)
      : dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLatest(userId);

    this.sellService.validateLightningRoute(route);

    if (dto.externalId) {
      const exists = await this.paymentLinkRepo.existsBy({
        externalId: dto.externalId,
        route: { user: { id: userId } },
      });
      if (exists) throw new ConflictException('Payment link already exists');
    }

    const newPaymentLink = await this.createForRoute(route, dto);
    return this.getOrThrow(userId, newPaymentLink.id);
  }

  async createInvoice(dto: CreateInvoicePaymentDto): Promise<PaymentLink> {
    const route = dto.route
      ? await this.sellService.getByLabel(undefined, dto.route)
      : await this.sellService.getById(+dto.routeId);

    this.sellService.validateLightningRoute(route);

    const existingLinks = await this.paymentLinkRepo.find({
      where: {
        externalId: dto.externalId,
        route: { user: { id: route.user.id } },
      },
      relations: { payments: true },
    });

    if (existingLinks.length) {
      const matchingLink = existingLinks.find(
        (l) =>
          l.payments[0]?.amount === +dto.amount && (l.payments[0]?.currency.name === dto.currency || !dto.currency),
      );
      if (matchingLink) return matchingLink;

      throw new ConflictException('Payment link already exists');
    }

    const payment: CreatePaymentLinkPaymentDto = {
      mode: PaymentLinkPaymentMode.SINGLE,
      amount: +dto.amount,
      externalId: dto.externalId,
      note: dto.note,
      currency: dto.currency,
      expiryDate: dto.expiryDate,
    };

    const paymentLinkDto: CreatePaymentLinkDto = {
      externalId: dto.externalId,
      webhookUrl: dto.webhookUrl,
      label: dto.label,
      payment,
    };

    return this.createForRoute(route, paymentLinkDto);
  }

  private async createForRoute(route: Sell, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const country = dto.config?.recipient?.address?.country
      ? await this.countryService.getCountryWithSymbol(dto.config?.recipient?.address?.country)
      : undefined;

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      label: dto.label,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: Util.createUniqueId(PaymentLinkService.PREFIX_UNIQUE_ID, 16),
      webhookUrl: dto.webhookUrl,
      name: dto.config?.recipient?.name,
      street: dto.config?.recipient?.address?.street,
      houseNumber: dto.config?.recipient?.address?.houseNumber,
      zip: dto.config?.recipient?.address?.zip,
      city: dto.config?.recipient?.address?.city,
      country: country,
      phone: dto.config?.recipient?.phone,
      mail: dto.config?.recipient?.mail,
      website: dto.config?.recipient?.website,
      payments: [],
      config: JSON.stringify(Util.removeDefaultFields(dto.config, route.userData.paymentLinksConfigObj)),
    });

    await this.paymentLinkRepo.save(paymentLink);

    dto.payment &&
      paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto.payment));

    return paymentLink;
  }

  async createPayRequestWithCompletionCheck(
    uniqueId: string,
    standardParam: PaymentStandard = PaymentStandard.OPEN_CRYPTO_PAY,
  ): Promise<PaymentLinkPayRequestDto> {
    const mostRecentPayment = await this.paymentLinkPaymentService.getMostRecentPayment(uniqueId);

    if (mostRecentPayment.status === PaymentLinkPaymentStatus.COMPLETED)
      throw new ConflictException(await this.paymentCompleteErrorResponse(uniqueId, standardParam));

    return this.createPayRequest(uniqueId, standardParam);
  }

  async createPayRequest(
    uniqueId: string,
    standardParam: PaymentStandard = PaymentStandard.OPEN_CRYPTO_PAY,
    waitTimeout = 10,
  ): Promise<PaymentLinkPayRequestDto> {
    const pendingPayment = await this.waitForPendingPayment(uniqueId, waitTimeout);
    if (!pendingPayment) throw new NotFoundException(await this.noPendingPaymentErrorResponse(uniqueId, standardParam));

    const { standards, displayQr } = pendingPayment.link.configObj;
    const usedStandard = pendingPayment.link.getMatchingStandard(standardParam);

    const actualQuote = await this.paymentQuoteService.createQuote(usedStandard, pendingPayment);

    const btcTransferAmount = actualQuote.getTransferAmountFor(Blockchain.LIGHTNING, 'BTC');
    if (!btcTransferAmount) throw new NotFoundException('No BTC transfer amount found');

    const msatTransferAmount = LightningHelper.btcToMsat(btcTransferAmount.amount);

    const payRequest: PaymentLinkPayRequestDto = {
      id: pendingPayment.link.uniqueId,
      externalId: pendingPayment.link.externalId,
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(uniqueId),
      minSendable: msatTransferAmount,
      maxSendable: msatTransferAmount,
      metadata: LightningHelper.createLnurlMetadata(pendingPayment.memo),
      displayName: pendingPayment.displayName,
      standard: usedStandard,
      possibleStandards: standards,
      displayQr,
      recipient: pendingPayment.link.recipient,
      quote: {
        id: actualQuote.uniqueId,
        expiration: actualQuote.expiryDate,
        payment: pendingPayment.uniqueId,
      },
      requestedAmount: {
        asset: pendingPayment.currency.name,
        amount: pendingPayment.amount,
      },
      transferAmounts: actualQuote.transferAmountsForPayRequest,
    };

    return payRequest;
  }

  private async waitForPendingPayment(uniqueId: string, timeout: number): Promise<PaymentLinkPayment> {
    return Util.poll(
      () => this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId),
      (p) => p?.status === PaymentLinkPaymentStatus.PENDING,
      1000,
      timeout * 1000,
    );
  }

  private async noPendingPaymentErrorResponse(
    uniqueId: string,
    standardParam: PaymentStandard,
  ): Promise<PaymentLinkPaymentErrorResponseDto | string> {
    const response = await this.createDefaultErrorResponse(uniqueId, standardParam);
    if (typeof response === 'string') return response;

    response.statusCode = new NotFoundException().getStatus();
    response.message = 'No pending payment found';
    response.error = 'Not Found';

    return response;
  }

  private async paymentCompleteErrorResponse(
    uniqueId: string,
    standardParam: PaymentStandard,
  ): Promise<PaymentLinkPaymentErrorResponseDto | string> {
    const response = await this.createDefaultErrorResponse(uniqueId, standardParam);
    if (typeof response === 'string') return response;

    response.statusCode = new ConflictException().getStatus();
    response.message = 'Payment complete';
    response.error = 'Conflict';

    return response;
  }

  private async createDefaultErrorResponse(
    uniqueId: string,
    standardParam: PaymentStandard,
  ): Promise<PaymentLinkPaymentErrorResponseDto | string> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { uniqueId, status: PaymentLinkStatus.ACTIVE },
      relations: { route: { user: { userData: true } } },
    });

    if (!paymentLink) return `Active payment link not found by id ${uniqueId}`;

    const { standards, displayQr } = paymentLink.configObj;
    const usedStandard = paymentLink.getMatchingStandard(standardParam);

    return {
      id: paymentLink.uniqueId,
      externalId: paymentLink.externalId,
      displayName: paymentLink.displayName(),
      standard: usedStandard,
      possibleStandards: standards,
      displayQr,
      recipient: paymentLink.recipient,
      statusCode: undefined,
      message: undefined,
      error: undefined,
    };
  }

  async update(
    userId: number,
    dto: UpdatePaymentLinkDto,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

    const { status, label, webhookUrl, config } = dto;
    const { name, address, phone, mail, website } = config?.recipient ?? {};
    const { street, houseNumber, zip, city, country } = address ?? {};

    const mergedConfig = { ...JSON.parse(paymentLink.config || '{}'), ...config };
    const customConfig = Util.removeDefaultFields(mergedConfig, paymentLink.route.userData.paymentLinksConfigObj);
    const configString = Object.keys(customConfig).length === 0 ? null : JSON.stringify(customConfig);

    const updatePaymentLink: Partial<PaymentLink> = {
      status,
      label,
      webhookUrl,
      street,
      houseNumber,
      zip,
      city,
      name,
      phone,
      mail,
      website,
      config: configString,
    };

    if (country === null) {
      updatePaymentLink.country = null;
    } else if (country) {
      updatePaymentLink.country = await this.countryService.getCountryWithSymbol(country);
      if (!updatePaymentLink.country) throw new NotFoundException('Country not found');
    }

    await this.updatePaymentLinkInternal(paymentLink, updatePaymentLink);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }

  async updatePaymentLinkAdmin(id: number, dto: UpdatePaymentLinkInternalDto): Promise<PaymentLink> {
    const entity = await this.paymentLinkRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('PaymentLink not found');

    if (dto.country) {
      dto.country = await this.countryService.getCountry(dto.country.id);
      if (!dto.country) throw new NotFoundException('Country not found');
    }

    return this.updatePaymentLinkInternal(entity, dto);
  }

  async getUserPaymentLinksConfig(userDataId: number): Promise<PaymentLinkConfigDto> {
    const userData = await this.userDataService.getUserData(userDataId, { users: { wallet: true } });
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('permission denied');

    return userData.paymentLinksConfigObj;
  }

  async updateUserPaymentLinksConfig(userDataId: number, dto: UpdatePaymentLinkConfigDto): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId, { users: { wallet: true } });
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('permission denied');

    await this.userDataService.updatePaymentLinksConfig(userData, dto);
  }

  async activateC2BPaymentLink(paymentLinkUniqueId: string, provider: C2BPaymentProvider): Promise<void> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { uniqueId: paymentLinkUniqueId },
      relations: { route: { user: { userData: true } } },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    const ids = await this.c2bPaymentLinkService.enrollPaymentLink(paymentLink, provider);
    await this.updateUserPaymentLinksConfig(paymentLink.route.userData.id, { ...ids });
  }

  private async updatePaymentLinkInternal(paymentLink: PaymentLink, dto: Partial<PaymentLink>): Promise<PaymentLink> {
    await this.paymentLinkRepo.update(paymentLink.id, dto);

    return Object.assign(paymentLink, dto);
  }

  // --- PAYMENTS --- //
  async createPayment(
    userId: number,
    dto: CreatePaymentLinkPaymentDto,
    linkId?: number,
    externalLinkId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId);

    paymentLink.payments = [await this.paymentLinkPaymentService.createPayment(paymentLink, dto)];

    return paymentLink;
  }

  async cancelPayment(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

    return this.paymentLinkPaymentService.cancelByLink(paymentLink);
  }

  async waitForPayment(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentService.waitForPayment(pendingPayment);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }

  async confirmPayment(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
    const payment = paymentLink.payments[0];
    if (!payment) throw new NotFoundException('Payment not found');

    await this.paymentLinkPaymentService.confirmPayment(payment);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }

  async generateOcpStickersPdf(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
    lang?: string,
  ): Promise<Buffer> {
    const linksFromDb = await this.sellService.getPaymentLinksFromRoute(routeIdOrLabel, externalIds, ids);
    const linkMapByExternalId = new Map(linksFromDb.map((link) => [link.externalId, link]));
    const linkMapById = new Map(linksFromDb.map((link) => [link.id, link]));
    const linksByExternalId = externalIds?.map((extId) => linkMapByExternalId.get(extId)).filter(Boolean) || [];
    const linksById = ids?.map((id) => linkMapById.get(id)).filter(Boolean) || [];
    const links = [...linksByExternalId, ...linksById];

    // Translated sticker title
    const stickerTitle = this.i18n.translate('payment.sticker.pay_with_crypto', {
      lang: lang?.toLowerCase() || 'en',
    });

    // Blue OCP Image
    const stickerPath = join(process.cwd(), 'assets', 'ocp-sticker.png');
    const stickerBuffer = readFileSync(stickerPath);

    // OCP Logo
    const ocpLogoPath = join(process.cwd(), 'assets', 'ocp-logo.png');
    const ocpLogoBuffer = readFileSync(ocpLogoPath);

    const qrPadding = 10;
    const borderWidth = 2.7;
    const borderColor = '#2130EE'; // #2130EE
    const cols = 2;
    const rows = 6;
    const margin = 30;
    const stickerSpacing = 20;
    const ocpLogoSize = 35;

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

          // QR Code URL
          const lnurl = LightningHelper.createEncodedLnurlp(uniqueId);
          const qrCodeUrl = `${Config.frontend.services}/pl?lightning=${lnurl}`;
          const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
            width: 400,
            margin: 0,
          });
          const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');

          // Add Blue OCP Image
          pdf.image(stickerBuffer, x, y, {
            width: pngWidth,
            height: stickerHeight + 1,
          });

          // Add QR-Code
          pdf.image(qrBuffer, x + pngWidth + qrPadding, y + qrPadding, {
            width: qrWidth - qrPadding * 2,
            height: stickerHeight - qrPadding * 2,
          });

          // Add OCP Logo
          pdf.image(
            ocpLogoBuffer,
            x + pngWidth + qrPadding + (qrWidth - qrPadding * 2 - ocpLogoSize) / 2,
            y + qrPadding + (stickerHeight - qrPadding * 2 - ocpLogoSize) / 2,
            {
              width: ocpLogoSize,
              height: ocpLogoSize,
            },
          );

          // Add title
          pdf.fontSize(10).font('Helvetica').fillColor('white');
          const labelX = x + 12;
          const labelY = y + 8;
          pdf.text(stickerTitle, labelX, labelY);

          // Add External ID
          pdf.fontSize(4).font('Helvetica').fillColor('black');
          const textWidth = pdf.widthOfString(externalId ?? id.toString());
          const textX = x + pngWidth - textWidth - 5;
          const textY = y + stickerHeight - 7;
          pdf.text(externalId ?? id.toString(), textX, textY);

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
}
