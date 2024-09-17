import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { CountryService } from 'src/shared/models/country/country.service';
import { Util } from 'src/shared/utils/util';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLinkPayRequestDto, PaymentLinkPaymentNotFoundDto } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto, UpdatePaymentLinkInternalDto } from '../dto/update-payment-link.dto';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentMode, PaymentLinkStatus, PaymentStandard } from '../enums';
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
    private readonly countryService: CountryService,
    private readonly sellService: SellService,
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

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLatest(userId);

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
    const existingLinks = await this.paymentLinkRepo.find({
      where: {
        externalId: dto.externalId,
        route: { id: +dto.routeId },
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
      currency: dto.currency,
      expiryDate: dto.expiryDate,
    };

    const route = await this.sellService.getById(+dto.routeId);

    return this.createForRoute(route, { externalId: dto.externalId, payment });
  }

  private async createForRoute(route: Sell, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    if (!route) throw new NotFoundException('Route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

    const country = dto.recipient?.address?.country
      ? await this.countryService.getCountryWithSymbol(dto.recipient?.address?.country)
      : undefined;

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: Util.createUniqueId(PaymentLinkService.PREFIX_UNIQUE_ID),
      webhookUrl: dto.webhookUrl,
      name: dto.recipient?.name,
      street: dto.recipient?.address?.street,
      houseNumber: dto.recipient?.address?.houseNumber,
      zip: dto.recipient?.address?.zip,
      city: dto.recipient?.address?.city,
      country: country,
      phone: dto.recipient?.phone,
      mail: dto.recipient?.mail,
      website: dto.recipient?.website,
      payments: [],
    });

    await this.paymentLinkRepo.save(paymentLink);

    dto.payment &&
      paymentLink.payments.push(await this.paymentLinkPaymentService.createPayment(paymentLink, dto.payment));

    return paymentLink;
  }

  async createPaymentLinkPayRequest(
    uniqueId: string,
    standardParam: PaymentStandard = PaymentStandard.OPEN_CRYPTO_PAY,
  ): Promise<PaymentLinkPayRequestDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(await this.noPendingPaymentResponse(uniqueId, standardParam));

    const { standards, displayQr } = pendingPayment.link.configObj;
    const usedStandard = pendingPayment.link.getMatchingStandard(standardParam);

    const actualQuote = await this.paymentQuoteService.createQuote(usedStandard, pendingPayment);

    const btcTransferAmount = actualQuote.getTransferAmountFor(Blockchain.LIGHTNING, 'BTC');
    if (!btcTransferAmount) throw new NotFoundException('No BTC transfer amount found');

    const msatTransferAmount = LightningHelper.btcToMsat(btcTransferAmount.amount);

    const payRequest: PaymentLinkPayRequestDto = {
      tag: 'payRequest',
      callback: LightningHelper.createLnurlpCallbackUrl(uniqueId),
      minSendable: msatTransferAmount,
      maxSendable: msatTransferAmount,
      metadata: LightningHelper.createLnurlMetadata(pendingPayment.memo),
      displayName: pendingPayment.displayName,
      standard: usedStandard,
      possibleStandards: standards,
      displayQr,
      recipient: PaymentLinkDtoMapper.toRecipientDto(pendingPayment.link),
      quote: {
        id: actualQuote.uniqueId,
        expiration: actualQuote.expiryDate,
      },
      requestedAmount: {
        asset: pendingPayment.currency.name,
        amount: pendingPayment.amount,
      },
      transferAmounts: actualQuote.transferAmountsAsObj,
    };

    return payRequest;
  }

  private async noPendingPaymentResponse(
    uniqueId: string,
    standardParam: PaymentStandard,
  ): Promise<PaymentLinkPaymentNotFoundDto | string> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { uniqueId, status: PaymentLinkStatus.ACTIVE },
      relations: { route: { user: { userData: true } } },
    });

    if (!paymentLink) return `Active payment link not found by id ${uniqueId}`;

    const { standards, displayQr } = paymentLink.configObj;
    const usedStandard = paymentLink.getMatchingStandard(standardParam);

    return {
      statusCode: new NotFoundException().getStatus(),
      message: 'No pending payment found',
      error: 'Not Found',

      displayName: paymentLink.displayName(),
      standard: usedStandard,
      possibleStandards: standards,
      displayQr,
      recipient: PaymentLinkDtoMapper.toRecipientDto(paymentLink),
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

    const { status, webhookUrl, recipient } = dto;
    const { name, address, phone, mail, website } = recipient ?? {};
    const { street, houseNumber, zip, city, country } = address ?? {};

    const updatePaymentLink: Partial<PaymentLink> = {
      status,
      webhookUrl,
      street,
      houseNumber,
      zip,
      city,
      name,
      phone,
      mail,
      website,
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

    return this.paymentLinkPaymentService.cancelPayment(paymentLink);
  }

  async waitForPayment(
    userId: number,
    linkId?: number,
    externalLinkId?: string,
    externalPaymentId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);

    await this.paymentLinkPaymentService.waitForPayment(paymentLink);

    return this.getOrThrow(userId, linkId, externalLinkId, externalPaymentId);
  }
}
