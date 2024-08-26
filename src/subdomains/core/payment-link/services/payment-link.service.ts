import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CountryService } from 'src/shared/models/country/country.service';
import { Util } from 'src/shared/utils/util';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreateInvoicePaymentDto } from '../dto/create-invoice-payment.dto';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentMode, PaymentLinkStatus } from '../enums';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentLinkService {
  static readonly PREFIX_UNIQUE_ID = 'pl';

  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly countryService: CountryService,
    private readonly sellService: SellService,
  ) {}

  async getOrThrow(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    let link: PaymentLink;
    if (linkId) link = await this.paymentLinkRepo.getPaymentLinkById(userId, linkId);
    if (linkExternalId) link = await this.paymentLinkRepo.getPaymentLinkByExternalId(userId, linkExternalId);

    if (!link) throw new NotFoundException('Payment link not found');

    if (!link.payments) link.payments = [];

    const mostRecentPayment = await this.paymentLinkPaymentService.getMostRecentPayment(link.uniqueId);
    if (mostRecentPayment) link.payments.push(mostRecentPayment);

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
        (l) => l.payments[0]?.amount === +dto.amount && l.payments[0]?.currency.name === dto.currency,
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

  async update(
    userId: number,
    dto: UpdatePaymentLinkDto,
    linkId?: number,
    linkExternalId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

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

    if (country) updatePaymentLink.country = await this.countryService.getCountryWithSymbol(country);
    if (country === null) updatePaymentLink.country = null;

    await this.paymentLinkRepo.update(paymentLink.id, updatePaymentLink);

    return this.getOrThrow(userId, linkId, linkExternalId);
  }

  // --- PAYMENTS --- //
  async createPayment(
    userId: number,
    dto: CreatePaymentLinkPaymentDto,
    linkId?: number,
    linkExternalId?: string,
  ): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    paymentLink.payments = [await this.paymentLinkPaymentService.createPayment(paymentLink, dto)];

    return paymentLink;
  }

  async cancelPayment(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    return this.paymentLinkPaymentService.cancelPayment(paymentLink);
  }

  async waitForPayment(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    const paymentLink = await this.getOrThrow(userId, linkId, linkExternalId);

    await this.paymentLinkPaymentService.waitForPayment(paymentLink);

    return this.getOrThrow(userId, linkId, linkExternalId);
  }
}
