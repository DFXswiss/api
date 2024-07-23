import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LessThan } from 'typeorm';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import {
  PaymentLinkForwardInfoDto,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  TransferInfo,
} from '../dto/payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';

@Injectable()
export class PaymentLinkPaymentService {
  static readonly PREFIX_UNIQUE_ID = 'plp';

  constructor(
    private paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly pricingService: PricingService,
  ) {}

  async processPendingPayments() {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentLinkPayments = await this.paymentLinkPaymentRepo.findBy({
      status: PaymentLinkPaymentStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentLinkPayment of pendingPaymentLinkPayments) {
      await this.paymentLinkPaymentRepo.save(pendingPaymentLinkPayment.expire());
    }
  }

  async getPendingPaymentByUniqueId(uniqueId: string): Promise<PaymentLinkPayment | null> {
    return this.paymentLinkPaymentRepo.findOne({
      where: [
        {
          link: { uniqueId: uniqueId },
          status: PaymentLinkPaymentStatus.PENDING,
        },
        {
          uniqueId: uniqueId,
          status: PaymentLinkPaymentStatus.PENDING,
        },
      ],
      relations: {
        link: true,
      },
    });
  }

  async getPendingPaymentByAsset(asset: Asset, amount: number): Promise<PaymentLinkPayment | null> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOneBy({
      activations: { asset: { id: asset.id }, amount },
      status: PaymentLinkPaymentStatus.PENDING,
    });

    if (!pendingPayment) return null;

    return this.paymentLinkPaymentRepo.findOne({
      where: { id: pendingPayment.id },
      relations: { link: true },
    });
  }

  async createPayment(paymentLink: PaymentLink, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLinkPayment> {
    if (paymentLink.status === PaymentLinkStatus.INACTIVE) throw new BadRequestException('Payment link is inactive');

    const pendingPayment = paymentLink.payments.some((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (pendingPayment)
      throw new ConflictException('There is already a pending payment for the specified payment link');

    if (dto.externalId) {
      const exists = await this.paymentLinkPaymentRepo.existsBy({
        externalId: dto.externalId,
        link: { id: paymentLink.id },
      });
      if (exists) throw new ConflictException('Payment already exists');
    }

    const currency = await this.fiatService.getFiat(dto.currency.id);
    if (!currency) throw new NotFoundException('Currency not found');

    return this.save(dto, currency, paymentLink);
  }

  async cancelPayment(userId: number, linkId?: number, linkExternalId?: string): Promise<PaymentLink> {
    const payment = await this.getPaymentByLink(userId, linkId, linkExternalId);

    const paymentLink = payment?.link;
    const entity = paymentLink?.payments.find((p) => p.id === payment.id);

    if (!entity) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentRepo.save(entity.cancel());

    return paymentLink;
  }

  private async createTransferAmounts(currency: Fiat, amount: number): Promise<TransferInfo[]> {
    const paymentAssets = await this.assetService.getPaymentAssets();

    return Promise.all(paymentAssets.map((asset) => this.getTransferAmount(currency, asset, amount)));
  }

  private async getTransferAmount(currency: Fiat, asset: Asset, amount: number): Promise<TransferInfo> {
    const price = await this.pricingService.getPrice(asset, currency, false);

    return {
      amount: asset.name == 'ZCHF' ? amount : price.invert().convert(amount) / 0.98,
      asset: asset.name,
      method: asset.blockchain,
    };
  }

  private async getPaymentByLink(
    userId: number,
    linkId?: number,
    linkExternalId?: string,
  ): Promise<PaymentLinkPayment | null> {
    if (linkId) return this.paymentLinkPaymentRepo.getPaymentByLinkId(userId, linkId, PaymentLinkPaymentStatus.PENDING);
    if (linkExternalId)
      return this.paymentLinkPaymentRepo.getPaymentByLinkExternalId(
        userId,
        linkExternalId,
        PaymentLinkPaymentStatus.PENDING,
      );

    return null;
  }

  async getPaymentLinkForwardInfo(paymentLinkId: string): Promise<PaymentLinkForwardInfoDto> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOne({
      where: {
        link: { uniqueId: paymentLinkId },
        status: PaymentLinkPaymentStatus.PENDING,
      },
      relations: {
        link: true,
      },
    });
    if (!pendingPayment) throw new NotFoundException(`No pending payment found by unique id ${paymentLinkId}`);

    return {
      paymentLinkId: pendingPayment.link.id,
      paymentLinkUniqueId: pendingPayment.link.uniqueId,
      paymentLinkExternalId: pendingPayment.link.externalId,
      paymentLinkPaymentId: pendingPayment.id,
      paymentLinkPaymentUniqueId: pendingPayment.uniqueId,
      paymentLinkPaymentExternalId: pendingPayment.externalId,
      transferAmounts: <TransferInfo[]>JSON.parse(pendingPayment.transferAmounts),
    };
  }

  async save(dto: CreatePaymentLinkPaymentDto, currency: Fiat, paymentLink: PaymentLink): Promise<PaymentLinkPayment> {
    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(Config.payment.timeout),
      mode: dto.mode,
      currency,
      uniqueId: Util.createUniqueId(PaymentLinkPaymentService.PREFIX_UNIQUE_ID),
      transferAmounts: await this.createTransferAmounts(currency, dto.amount).then(JSON.stringify),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(payment);
  }

  async complete(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    return this.paymentLinkPaymentRepo.save(payment.complete());
  }
}
