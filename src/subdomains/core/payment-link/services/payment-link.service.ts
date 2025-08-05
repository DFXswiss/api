import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { C2BPaymentLinkService } from 'src/subdomains/core/payment-link/services/c2b-payment-link.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkConfigDto, UpdatePaymentLinkConfigDto } from '../dto/payment-link-config.dto';
import { PaymentLinkPaymentErrorResponseDto, PaymentLinkPayRequestDto } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto, UpdatePaymentLinkInternalDto } from '../dto/update-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLinkConfig } from '../entities/payment-link.config';
import { PaymentLink } from '../entities/payment-link.entity';
import {
  C2BPaymentProvider,
  PaymentLinkMode,
  PaymentLinkPaymentMode,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  PaymentStandard,
} from '../enums';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentLinkService {
  private readonly logger = new DfxLogger(PaymentLinkService);

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly userDataService: UserDataService,
    private readonly countryService: CountryService,
    private readonly sellService: SellService,
    private readonly c2bPaymentLinkService: C2BPaymentLinkService,
  ) {}

  async getOrThrow(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
    loadPayments = true,
  ): Promise<PaymentLink> {
    const link = await this.paymentLinkRepo.getPaymentLinkById(userId, linkId, externalLinkId, externalPaymentId);
    if (!link) throw new NotFoundException('Payment link not found');

    if (!link.payments) link.payments = [];

    if (loadPayments) {
      const payment = externalPaymentId
        ? await this.paymentLinkPaymentService.getPaymentByExternalId(externalPaymentId)
        : await this.paymentLinkPaymentService.getMostRecentPayment(link.uniqueId);
      if (payment) link.payments.push(payment);
    }

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

  async getHistoryByStatus(
    userId?: number,
    status?: string,
    from?: Date,
    to?: Date,
    key?: string,
    externalLinkId?: string,
  ): Promise<PaymentLink[]> {
    const ownerUserId = Boolean(userId)
      ? userId
      : (await this.getPaymentLinkByAccessKey(key, externalLinkId)).route.user.id;

    const paymentStatus = status?.split(',').map((s) => Util.toEnum(PaymentLinkPaymentStatus, s)) ?? [
      PaymentLinkPaymentStatus.COMPLETED,
    ];

    const fromDate = from ?? Util.firstDayOfMonth();
    const toDate = to ?? Util.lastDayOfMonth();

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    return this.paymentLinkRepo.getHistoryByStatus(ownerUserId, paymentStatus, fromDate, toDate, externalLinkId);
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

  private async tryEnrollC2BPaymentLink(
    paymentLink: PaymentLink,
    provider: C2BPaymentProvider,
  ): Promise<Record<string, string> | undefined> {
    try {
      return await this.c2bPaymentLinkService.enrollPaymentLink(paymentLink, provider);
    } catch (e) {
      e instanceof BadRequestException
        ? this.logger.info(`C2B payment link ${paymentLink.uniqueId} is not eligible for enrollment: ${e.message}`)
        : this.logger.error(`Failed to enroll C2B payment link ${paymentLink.uniqueId}:`, e);
    }
  }

  private async createForRoute(route: Sell, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      label: dto.label,
      status: PaymentLinkStatus.ACTIVE,
      mode: dto.mode,
      uniqueId: Util.createUniqueId(Config.prefixes.paymentLinkUidPrefix, 16),
      webhookUrl: dto.webhookUrl,
      payments: [],
      config: JSON.stringify(Util.removeDefaultFields(dto.config, route.userData.paymentLinksConfigObj)),
    });

    const c2bIds = await this.tryEnrollC2BPaymentLink(paymentLink, C2BPaymentProvider.BINANCE_PAY);
    if (c2bIds) paymentLink.config = this.getMergedConfig(paymentLink, c2bIds);

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
      mode: pendingPayment.link.mode,
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(uniqueId),
      minSendable: msatTransferAmount,
      maxSendable: msatTransferAmount,
      metadata: LightningHelper.createLnurlMetadata(pendingPayment.memo),
      displayName: pendingPayment.displayName,
      standard: usedStandard,
      possibleStandards: standards,
      displayQr,
      recipient: pendingPayment.link.configObj.recipient,
      route: pendingPayment.link.route.route.label,
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
      route: paymentLink.route.route.label,
      currency: paymentLink.route.fiat?.name,
      displayQr,
      recipient: paymentLink.configObj.recipient,
      mode: paymentLink.mode,
      statusCode: undefined,
      message: undefined,
      error: undefined,
      transferAmounts: await this.paymentQuoteService.createTransferAmounts(usedStandard, paymentLink),
    };
  }

  private getMergedConfig(paymentLink: PaymentLink, config: Partial<PaymentLinkConfig>): string | null {
    const mergedConfig = { ...JSON.parse(paymentLink.config || '{}'), ...config };
    const customConfig = Util.removeDefaultFields(mergedConfig, paymentLink.route.userData.paymentLinksConfigObj);
    return Object.keys(customConfig).length === 0 ? null : (JSON.stringify(customConfig) as string);
  }

  async update(
    userId: number,
    dto: UpdatePaymentLinkDto,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId, false);

    const { status, mode, label, webhookUrl, config } = dto;
    if (mode === PaymentLinkMode.SINGLE) throw new BadRequestException('Cannot update mode to single');

    const updatePaymentLink: Partial<PaymentLink> = {
      status,
      mode,
      label,
      webhookUrl,
      config: this.getMergedConfig(paymentLink, config),
    };

    await this.updatePaymentLinkInternal(paymentLink, updatePaymentLink);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }

  async updatePaymentLinkAdmin(id: number, dto: UpdatePaymentLinkInternalDto): Promise<PaymentLink> {
    const entity = await this.paymentLinkRepo.findOne({
      where: { id },
      relations: { route: { user: { userData: true } } },
    });
    if (!entity) throw new NotFoundException('PaymentLink not found');

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
    const config = this.getMergedConfig(paymentLink, ids);
    await this.paymentLinkRepo.update(paymentLink.id, { config });
  }

  private async updatePaymentLinkInternal(paymentLink: PaymentLink, dto: Partial<PaymentLink>): Promise<PaymentLink> {
    if (!this.c2bPaymentLinkService.isPaymentLinkEnrolled(Blockchain.BINANCE_PAY, paymentLink)) {
      const c2bIds = await this.tryEnrollC2BPaymentLink(
        Object.assign(paymentLink, dto),
        C2BPaymentProvider.BINANCE_PAY,
      );

      if (c2bIds) {
        const incomingNewConfig = JSON.parse(dto.config || '{}');
        const configsWithKeys = { ...incomingNewConfig, ...c2bIds };
        dto.config = this.getMergedConfig(paymentLink, configsWithKeys);
      }
    }

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

  async createPaymentForRouteWithAccessKey(
    dto: CreatePaymentLinkPaymentDto,
    key: string,
    externalLinkId: string,
    routeLabel?: string,
  ): Promise<PaymentLink> {
    const existingPaymentLink = await this.getPaymentLinkByAccessKey(key, externalLinkId).catch(() => null);
    if (!existingPaymentLink && !routeLabel) throw new BadRequestException('Route label is required');

    const route = existingPaymentLink?.route ?? (await this.sellService.getByLabel(undefined, routeLabel));
    if (!route) throw new NotFoundException('Route not found');

    const plAccessKeys = existingPaymentLink?.linkConfigObj?.accessKeys ?? [];
    const userAccessKeys = route.user.userData.paymentLinksConfigObj.accessKeys ?? [];
    const hasAccessKey = plAccessKeys.includes(key) || userAccessKeys.includes(key);
    if (!hasAccessKey) throw new UnauthorizedException('Invalid access key');

    if (existingPaymentLink) {
      if (dto.amount !== 0)
        existingPaymentLink.payments = [await this.paymentLinkPaymentService.createPayment(existingPaymentLink, dto)];

      return existingPaymentLink;
    }

    return this.create(route.user.id, {
      externalId: externalLinkId,
      payment: dto.amount !== 0 ? dto : undefined,
    });
  }

  async getPublicPaymentLink(routeLabel: string, externalLinkId: string): Promise<PaymentLink> {
    const route = await this.sellService.getByLabel(undefined, routeLabel);
    if (!route) throw new NotFoundException('Route not found');

    const paymentLink = await this.getOrThrow(route.user.id, undefined, externalLinkId);
    if (paymentLink.mode !== PaymentLinkMode.PUBLIC) throw new UnauthorizedException('Payment link is not public');

    return paymentLink;
  }

  async createPublicPayment(
    dto: CreatePaymentLinkPaymentDto,
    routeLabel: string,
    externalLinkId: string,
  ): Promise<PaymentLink> {
    if (dto.amount === 0) throw new BadRequestException('Amount must be greater than 0');

    const paymentLink = await this.getPublicPaymentLink(routeLabel, externalLinkId);
    if (paymentLink.payments.some((p) => p.status === PaymentLinkPaymentStatus.PENDING))
      throw new ConflictException('There is already a pending payment for the specified payment link');

    const payment = await this.paymentLinkPaymentService.createPayment(paymentLink, dto);
    paymentLink.payments = [payment];

    return paymentLink;
  }

  async cancelPayment(
    userId?: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
    key?: string,
    routeLabel?: string,
  ): Promise<PaymentLink> {
    const paymentLink = Boolean(userId)
      ? await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId)
      : Boolean(key)
      ? await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId)
      : await this.getPublicPaymentLink(routeLabel, externalLinkId);

    return this.paymentLinkPaymentService.cancelByLink(paymentLink);
  }

  async getPaymentLinkByAccessKey(
    key: string,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    if (externalLinkId) {
      const paymentLinks = await this.paymentLinkRepo.getAllPaymentLinksByExternalLinkId(externalLinkId);
      const paymentLink = paymentLinks.find((p) => p.configObj.accessKeys?.includes(key));
      if (!paymentLink) throw new NotFoundException('No payment link found');

      return this.getOrThrow(paymentLink.route.user.id, paymentLink.id, paymentLink.externalId);
    }

    if (externalPaymentId) {
      const payments = await this.paymentLinkPaymentService.getAllPaymentsByExternalLinkId(externalPaymentId);
      const payment = payments.find((p) => p.link.configObj.accessKeys?.includes(key));
      if (!payment) throw new NotFoundException('No payment found');

      return this.getOrThrow(payment.link.route.user.id, payment.link.id, payment.link.externalId, payment.externalId);
    }

    throw new BadRequestException('Either externalLinkId or externalPaymentId must be provided');
  }

  async waitForPayment(
    userId?: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
    key?: string,
  ): Promise<PaymentLink> {
    const paymentLink = Boolean(userId)
      ? await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId)
      : await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId);

    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentService.waitForPayment(pendingPayment);

    return this.getOrThrow(paymentLink.route.user.id, linkId, externalLinkId, pendingPayment.externalId);
  }

  async confirmPayment(
    userId?: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
    key?: string,
  ): Promise<PaymentLink> {
    const paymentLink = Boolean(userId)
      ? await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId)
      : await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId);

    const payment = paymentLink.payments[0];
    if (!payment) throw new NotFoundException('Payment not found');

    await this.paymentLinkPaymentService.confirmPayment(payment);

    return this.getOrThrow(paymentLink.route.user.id, linkId, externalLinkId, payment.externalId);
  }

  async createPosLinkUser(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<string> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId, false);

    return this.createPosLinkFor(paymentLink, false);
  }

  async createPosLinkAdmin(paymentLinkId: number, scoped: boolean): Promise<string> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id: paymentLinkId },
      relations: { route: { user: { userData: true } } },
    });
    if (!paymentLink) throw new NotFoundException('PaymentLink not found');

    return this.createPosLinkFor(paymentLink, scoped);
  }

  private async createPosLinkFor(paymentLink: PaymentLink, scoped: boolean): Promise<string> {
    const config = scoped ? paymentLink.linkConfigObj : paymentLink.route.userData.paymentLinksConfigObj;

    let accessKey = config.accessKeys?.at(0);
    if (!accessKey) {
      accessKey = Util.secureRandomString();

      const update = { accessKeys: [accessKey] };

      if (scoped) {
        await this.paymentLinkRepo.update(paymentLink.id, { config: this.getMergedConfig(paymentLink, update) });
      } else {
        await this.userDataService.updatePaymentLinksConfig(paymentLink.route.user.userData, update);
      }
    }

    const search = new URLSearchParams({
      lightning: LightningHelper.createEncodedLnurlp(paymentLink.uniqueId),
      key: accessKey,
    });

    return `${Config.frontend.services}/pl/pos?${search.toString()}`;
  }
}
