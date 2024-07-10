import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkPaymentStatus, PaymentLinkStatus, TransferInfo } from '../dto/payment-link.dto';
import { UpdatePaymentLinkDto } from '../dto/update-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';

@Injectable()
export class PaymentLinkService {
  constructor(
    private readonly paymentLinkRepo: PaymentLinkRepository,
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly sellService: SellService,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
  ) {}

  async get(userId: number, id: number): Promise<PaymentLink> {
    return this.paymentLinkRepo.findOne({ where: { id, route: { user: { id: userId } } }, relations: { route: true } });
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    return this.paymentLinkRepo.find({ where: { route: { user: { id: userId } } }, relations: { route: true } });
  }

  async update(userId: number, id: number, dto: UpdatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id, route: { user: { id: userId } } },
      relations: { route: true },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    paymentLink.status = dto.status;
    await this.paymentLinkRepo.update(paymentLink.id, { status: paymentLink.status });

    return paymentLink;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = await this.sellService.get(userId, dto.routeId);
    if (!route) throw new NotFoundException('Route not found');

    if (dto.externalId) {
      const exists = await this.paymentLinkRepo.existsBy({
        externalId: dto.externalId,
        route: { user: { id: userId } },
      });
      if (exists) throw new ConflictException('Payment link already exists');
    }

    const paymentLink = this.paymentLinkRepo.create({
      route,
      externalId: dto.externalId,
      status: PaymentLinkStatus.ACTIVE,
      uniqueId: this.createUniqueId('pl'),
      payments: [],
    });

    await this.paymentLinkRepo.save(paymentLink);

    dto.payment && paymentLink.payments.push(await this.createPaymentFor(paymentLink, dto.payment));

    return paymentLink;
  }

  // --- PAYMENTS --- //
  async createPayment(userId: number, linkId: number, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.findOne({
      where: { id: linkId, route: { user: { id: userId } } },
      relations: { route: true },
    });
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    paymentLink.payments.push(await this.createPaymentFor(paymentLink, dto));

    return paymentLink;
  }

  private async createPaymentFor(
    paymentLink: PaymentLink,
    dto: CreatePaymentLinkPaymentDto,
  ): Promise<PaymentLinkPayment> {
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

    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(60),
      mode: dto.mode,
      currency: dto.currency,
      uniqueId: this.createUniqueId('plp'),
      transferAmounts: await this.createTransferAmounts(dto.currency, dto.amount).then(JSON.stringify),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(payment);
  }

  async cancelPayment(userId: number, linkId: number): Promise<void> {
    const pendingPayment = await this.paymentLinkPaymentRepo.findOneBy({
      link: { id: linkId, route: { user: { id: userId } } },
      status: PaymentLinkPaymentStatus.PENDING,
    });
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentRepo.update(pendingPayment.id, { status: PaymentLinkPaymentStatus.CANCELLED });
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

  private createUniqueId(prefix: string): string {
    const hash = Util.createHash(`${Date.now()}${Util.randomId()}`).toLowerCase();
    return `${prefix}_${hash.slice(0, 6)}`;
  }
}
