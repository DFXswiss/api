import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { merge } from 'lodash';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { C2BPaymentLinkService } from 'src/subdomains/core/payment-link/services/c2b-payment-link.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { DepositRouteService } from 'src/subdomains/supporting/address-pool/route/deposit-route.service';
import { In, Not } from 'typeorm';
import { isSellRoute } from '../../sell-crypto/route/sell.entity';
import { AssignPaymentLinkDto } from '../dto/assign-payment-link.dto';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { UpdatePaymentLinkConfigDto, UserPaymentLinkConfigDto } from '../dto/payment-link-config.dto';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLinkRecipientAddressDto } from '../dto/payment-link-recipient-address.dto';
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
    private readonly depositRouteService: DepositRouteService,
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

  private async getForUserOrPublic(
    userId?: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
    routeLabel?: string,
  ) {
    const link = Boolean(userId)
      ? await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId).catch(() => undefined)
      : undefined;

    return link ?? this.getPublicPaymentLink(routeLabel, externalLinkId);
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    const allPaymentLinks = await this.paymentLinkRepo.getAllPaymentLinks(userId);

    const mostRecentPayments = await this.paymentLinkPaymentService
      .getMostRecentPayments(allPaymentLinks.map((pl) => pl.id))
      .then((l) => new Map(l.map((p) => [p.link.id, p])));

    for (const paymentLink of allPaymentLinks) {
      const mostRecentPayment = mostRecentPayments.get(paymentLink.id);
      paymentLink.payments = mostRecentPayment ? [mostRecentPayment] : [];
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
    const ownerUserId = Boolean(key)
      ? await this.getPaymentLinkByAccessKey(key, externalLinkId).then((pl) => pl.route.user.id)
      : userId;

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
      ? await this.depositRouteService.getByLabel(userId, dto.route)
      : dto.routeId
        ? await this.depositRouteService.get(userId, dto.routeId)
        : await this.depositRouteService.getLatest(userId);

    if (route?.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

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
      ? await this.depositRouteService.getByLabel(undefined, dto.route)
      : await this.depositRouteService.getById(+dto.routeId);

    if (route?.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

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

  private async createForRoute(route: DepositRoute, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      label: dto.label,
      status: PaymentLinkStatus.ACTIVE,
      mode: dto.mode,
      uniqueId: Util.createUniqueId(Config.prefixes.paymentLinkUidPrefix),
      webhookUrl: dto.webhookUrl,
      payments: [],
      config: JSON.stringify(Util.removeDefaultFields(dto.config, route.userData.paymentLinksConfigObj)),
    });

    const c2bIds = await this.tryEnrollC2BPaymentLink(paymentLink, C2BPaymentProvider.BINANCE_PAY);
    if (c2bIds) paymentLink.config = this.getMergedConfigString(paymentLink, c2bIds);

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

    if (mostRecentPayment.status === PaymentLinkPaymentStatus.COMPLETED) {
      const paymentLink = await this.getActivePaymentLink(uniqueId);
      return this.handleError(paymentLink, standardParam, ConflictException, 'Payment complete');
    }

    return this.createPayRequest(uniqueId, standardParam);
  }

  async createPayRequest(
    uniqueId: string,
    standardParam: PaymentStandard = PaymentStandard.OPEN_CRYPTO_PAY,
    waitTimeout = 10,
  ): Promise<PaymentLinkPayRequestDto> {
    const pendingPayment = await this.waitForPendingPayment(uniqueId, waitTimeout);
    if (!pendingPayment) await this.handleNoPendingPayment(uniqueId, standardParam);

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

  private async handleNoPendingPayment(uniqueId: string, standardParam: PaymentStandard): Promise<never> {
    const paymentLink = await this.getActivePaymentLink(uniqueId);

    if (paymentLink.status === PaymentLinkStatus.UNASSIGNED) {
      return this.handleError(paymentLink, standardParam, BadRequestException, 'Payment link not assigned');
    } else {
      return this.handleError(paymentLink, standardParam, NotFoundException, 'No pending payment found');
    }
  }

  private async handleError(
    paymentLink: PaymentLink,
    standardParam: PaymentStandard,
    ErrorType: new (...args: any[]) => HttpException,
    message: string,
  ): Promise<never> {
    const response = await this.createDefaultErrorResponse(paymentLink, standardParam);

    const error = new ErrorType(message);
    Object.assign(response, error.getResponse());

    throw new ErrorType(response);
  }

  private async createDefaultErrorResponse(
    paymentLink: PaymentLink,
    standardParam: PaymentStandard,
  ): Promise<PaymentLinkPaymentErrorResponseDto> {
    const { standards, displayQr } = paymentLink.configObj;
    const usedStandard = paymentLink.getMatchingStandard(standardParam);

    return {
      id: paymentLink.uniqueId,
      externalId: paymentLink.externalId,
      displayName: paymentLink.displayName(),
      standard: usedStandard,
      possibleStandards: standards,
      route: paymentLink.route.route.label,
      currency: isSellRoute(paymentLink.route) ? paymentLink.route.fiat?.name : undefined,
      displayQr,
      recipient: paymentLink.configObj.recipient,
      mode: paymentLink.mode,
      statusCode: undefined,
      message: undefined,
      error: undefined,
      transferAmounts: await this.paymentQuoteService.createTransferAmounts(usedStandard, paymentLink),
    };
  }

  private getMergedConfig(paymentLink: PaymentLink, config: Partial<PaymentLinkConfig>): Partial<PaymentLinkConfig> {
    const existingConfig: PaymentLinkConfig = JSON.parse(paymentLink.config || '{}');

    const mergedConfig: PaymentLinkConfig = {
      ...existingConfig,
      ...config,
    };
    if (existingConfig.recipient || config?.recipient)
      mergedConfig.recipient = merge(existingConfig.recipient, config?.recipient);

    return Util.removeDefaultFields(mergedConfig, paymentLink.route.userData.paymentLinksConfigObj);
  }

  private getMergedConfigString(paymentLink: PaymentLink, config: Partial<PaymentLinkConfig>): string | null {
    const customConfig = this.getMergedConfig(paymentLink, config);
    return this.configToString(customConfig);
  }

  private configToString(config: Partial<PaymentLinkConfig>): string | null {
    return Object.keys(config).length === 0 ? null : (JSON.stringify(config) as string);
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
    if (status === PaymentLinkStatus.UNASSIGNED) throw new BadRequestException('Cannot update status to unassigned');
    if (mode === PaymentLinkMode.SINGLE) throw new BadRequestException('Cannot update mode to single');

    const updatePaymentLink: Partial<PaymentLink> = {
      status,
      mode,
      label,
      webhookUrl,
      config: JSON.stringify(config),
    };

    await this.updatePaymentLinkInternal(paymentLink, updatePaymentLink);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }

  async updatePaymentLinkAdmin(id: number, dto: UpdatePaymentLinkInternalDto): Promise<PaymentLink> {
    const entity = await this.paymentLinkRepo.findOne({
      where: { id },
      relations: { route: { user: { userData: { organization: true } } } },
    });
    if (!entity) throw new NotFoundException('Payment link not found');

    return this.updatePaymentLinkInternal(entity, dto);
  }

  async getUserPaymentLinksConfig(userDataId: number): Promise<UserPaymentLinkConfigDto> {
    const userData = await this.userDataService.getUserData(userDataId, { users: { wallet: true } });
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('permission denied');

    const config = userData.paymentLinksConfigObj;
    const configDto = PaymentLinkDtoMapper.toConfigDto(userData.paymentLinksConfigObj);
    return { ...configDto, accessKey: config.accessKeys?.at(0) };
  }

  async updateUserPaymentLinksConfig(userDataId: number, dto: UpdatePaymentLinkConfigDto): Promise<void> {
    const userData = await this.userDataService.getUserData(userDataId, { users: { wallet: true } });
    if (!userData.paymentLinksAllowed) throw new ForbiddenException('permission denied');

    await this.userDataService.updatePaymentLinksConfig(userData, dto);
  }

  async activateC2BPaymentLink(paymentLinkUniqueId: string, provider: C2BPaymentProvider): Promise<void> {
    const paymentLink = await this.getActivePaymentLink(paymentLinkUniqueId);

    const ids = await this.c2bPaymentLinkService.enrollPaymentLink(paymentLink, provider);
    const config = this.getMergedConfigString(paymentLink, ids);
    await this.paymentLinkRepo.update(paymentLink.id, { config });
  }

  private async updatePaymentLinkInternal(paymentLink: PaymentLink, dto: Partial<PaymentLink>): Promise<PaymentLink> {
    const mergedConfig = this.getMergedConfig(paymentLink, JSON.parse(dto.config || '{}'));

    if (!this.c2bPaymentLinkService.isPaymentLinkEnrolled(Blockchain.BINANCE_PAY, paymentLink)) {
      dto.config = this.configToString(mergedConfig);

      const c2bIds = await this.tryEnrollC2BPaymentLink(
        Object.assign(paymentLink, dto),
        C2BPaymentProvider.BINANCE_PAY,
      );

      if (c2bIds) Object.assign(mergedConfig, c2bIds);
    }

    dto.config = this.configToString(mergedConfig);

    await this.paymentLinkRepo.update(paymentLink.id, dto);

    return Object.assign(paymentLink, dto);
  }

  private async getActivePaymentLink(uniqueId: string): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { uniqueId, status: Not(PaymentLinkStatus.INACTIVE) },
      relations: { route: { user: { userData: { organization: true } } } },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    return paymentLink;
  }

  public async assignPaymentLink(
    id: number | undefined,
    externalId: string | undefined,
    dto: AssignPaymentLinkDto,
  ): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id, externalId, status: PaymentLinkStatus.UNASSIGNED },
      relations: { route: { user: { userData: { organization: true } } } },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    const route = await this.depositRouteService.getPaymentRoutesForPublicName(dto.publicName).then((l) => l.at(0));
    if (!route) throw new NotFoundException('No matching payment route found');

    await this.updatePaymentLinkInternal(paymentLink, { status: PaymentLinkStatus.ACTIVE, route });

    return paymentLink;
  }

  async getLocations(publicName: string): Promise<PaymentLinkRecipientAddressDto[]> {
    const routes = await this.depositRouteService.getPaymentRoutesForPublicName(publicName);
    const paymentLinks = await this.paymentLinkRepo.find({
      where: { route: { id: In(routes.map((r) => r.id)) } },
      relations: { route: { user: { userData: { organization: true } } } },
    });

    const locations = paymentLinks.map((pl) => pl.configObj.recipient?.address);

    // unique
    return Array.from(new Map(locations.map((l) => [JSON.stringify(l), l])).values());
  }

  // --- PAYMENTS --- //
  async createPayment(
    dto: CreatePaymentLinkPaymentDto,
    userId?: number,
    linkId?: number,
    externalLinkId?: string,
    routeLabel?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getForUserOrPublic(userId, linkId, externalLinkId, undefined, routeLabel);

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

    const route = existingPaymentLink?.route ?? (await this.depositRouteService.getByLabel(undefined, routeLabel));
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
    const route = await this.depositRouteService.getByLabel(undefined, routeLabel);
    if (!route) throw new NotFoundException('Route not found');

    const paymentLink = await this.getOrThrow(route.user.id, undefined, externalLinkId);
    if (paymentLink.mode !== PaymentLinkMode.PUBLIC) throw new UnauthorizedException('Payment link is not public');

    return paymentLink;
  }

  async getPublicPaymentLinkByUniqueId(uniqueId: string): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { uniqueId, mode: PaymentLinkMode.PUBLIC, status: PaymentLinkStatus.ACTIVE },
      relations: { route: { user: { userData: true } } },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

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
    const paymentLink = Boolean(key)
      ? await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId)
      : await this.getForUserOrPublic(userId, linkId, externalLinkId, externalPaymentId, routeLabel);

    return this.paymentLinkPaymentService.cancelByLink(paymentLink);
  }

  async deletePaymentLink(linkId: number): Promise<void> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id: linkId },
      relations: { payments: { quotes: true, activations: true, cryptoInputs: true } },
    });
    if (!paymentLink) throw new NotFoundException('PaymentLink not found');
    if (paymentLink.payments.some((p) => p.status === PaymentLinkPaymentStatus.COMPLETED || p.cryptoInputs?.length))
      throw new BadRequestException('PaymentLink cannot be deleted with active payments');

    for (const payment of paymentLink.payments) {
      await this.paymentLinkPaymentService.deletePayment(payment);
    }
    await this.paymentLinkRepo.delete(paymentLink.id);
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
    const paymentLink = Boolean(key)
      ? await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId)
      : await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

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
    const paymentLink = Boolean(key)
      ? await this.getPaymentLinkByAccessKey(key, externalLinkId, externalPaymentId)
      : await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

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

    return this.createPosLinkFor(paymentLink);
  }

  async createPosLinkAdmin(paymentLinkId: number, scoped?: boolean): Promise<string> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id: paymentLinkId },
      relations: { route: { user: { userData: { organization: true } } } },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    return this.createPosLinkFor(paymentLink, scoped);
  }

  private async createPosLinkFor(paymentLink: PaymentLink, scoped?: boolean): Promise<string> {
    const config =
      scoped == null
        ? paymentLink.configObj
        : scoped
        ? paymentLink.linkConfigObj
        : paymentLink.route.userData.paymentLinksConfigObj;

    let accessKey = config.accessKeys?.at(0);
    if (!accessKey) {
      accessKey = Util.secureRandomString();

      const update = { accessKeys: [accessKey] };

      if (scoped) {
        await this.paymentLinkRepo.update(paymentLink.id, { config: this.getMergedConfigString(paymentLink, update) });
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
