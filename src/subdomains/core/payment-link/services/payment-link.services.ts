import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import {
  PaymentLinkForwardInfoDto,
  PaymentLinkPaymentStatus,
  PaymentLinkStatus,
  TransferInfo,
} from '../dto/payment-link.dto';
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
    private readonly fiatService: FiatService,
    private readonly pricingService: PricingService,
    private readonly evmRegistryService: EvmRegistryService,
  ) {}

  async get(userId: number, idOrExternalId: string): Promise<PaymentLink> {
    return this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
  }

  async getAll(userId: number): Promise<PaymentLink[]> {
    return this.paymentLinkRepo.find({ where: { route: { user: { id: userId } } }, relations: { route: true } });
  }

  async update(userId: number, idOrExternalId: string, dto: UpdatePaymentLinkDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
    if (!paymentLink) throw new NotFoundException('Payment link not found');

    paymentLink.status = dto.status;
    await this.paymentLinkRepo.update(paymentLink.id, { status: paymentLink.status });

    return paymentLink;
  }

  async create(userId: number, dto: CreatePaymentLinkDto): Promise<PaymentLink> {
    const route = dto.routeId
      ? await this.sellService.get(userId, dto.routeId)
      : await this.sellService.getLastest(userId);

    if (!route) throw new NotFoundException('Route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');

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
  async createPayment(userId: number, idOrExternalId: string, dto: CreatePaymentLinkPaymentDto): Promise<PaymentLink> {
    const paymentLink = await this.paymentLinkRepo.getPaymentLink(userId, idOrExternalId);
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

    const currency = await this.fiatService.getFiat(dto.currency.id);
    if (!currency) throw new NotFoundException('Currency not found');

    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(Config.payment.timeout),
      mode: dto.mode,
      currency,
      uniqueId: this.createUniqueId('plp'),
      transferAmounts: await this.createTransferAmounts(currency, dto.amount).then(JSON.stringify),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(payment);
  }

  async cancelPayment(userId: number, linkOrExternalId: string): Promise<PaymentLink> {
    const payment = await this.paymentLinkPaymentRepo.getPayment(
      userId,
      linkOrExternalId,
      PaymentLinkPaymentStatus.PENDING,
    );

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

  private createUniqueId(prefix: string): string {
    const hash = Util.createHash(`${Date.now()}${Util.randomId()}`).toLowerCase();
    return `${prefix}_${hash.slice(0, 6)}`;
  }

  async getPaymentLinkForwardInfo(paymentLinkId: string): Promise<PaymentLinkForwardInfoDto> {
    const pendingPayments = await this.paymentLinkPaymentRepo.find({
      where: {
        link: { uniqueId: paymentLinkId },
        status: PaymentLinkPaymentStatus.PENDING,
      },
      relations: {
        link: true,
      },
    });
    if (!pendingPayments.length) throw new NotFoundException(`No pending payment found by unique id ${paymentLinkId}`);

    const pendingPayment = pendingPayments[0];

    return {
      paymentLinkExternalId: pendingPayment.link.externalId,
      paymentLinkPaymentId: pendingPayment.uniqueId,
      paymentLinkPaymentExternalId: pendingPayment.externalId,
      transferAmounts: <TransferInfo[]>JSON.parse(pendingPayment.transferAmounts),
    };
  }
}
