import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LessThan } from 'typeorm';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { PaymentLinkPaymentStatus, PaymentLinkStatus, TransferInfo } from '../dto/payment-link.dto';
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

  // --- HANDLE PENDING PAYMENTS --- //
  async processPendingPayments(): Promise<void> {
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
    const pendingPayment = await this.paymentLinkPaymentRepo.findOne({
      where: {
        activations: { asset: { id: asset.id }, amount },
        status: PaymentLinkPaymentStatus.PENDING,
      },
      relations: {
        activations: true,
      },
    });

    if (!pendingPayment) return null;

    return this.paymentLinkPaymentRepo.findOne({
      where: { id: pendingPayment.id },
      relations: {
        link: true,
        activations: true,
      },
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

  async cancelPayment(paymentLink: PaymentLink): Promise<PaymentLink> {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);
    if (!pendingPayment) throw new NotFoundException('No pending payment found');

    await this.paymentLinkPaymentRepo.save(pendingPayment.cancel());

    return paymentLink;
  }

  private async createTransferInfo(currency: Fiat, amount: number): Promise<TransferInfo[]> {
    const paymentAssets = await this.assetService.getPaymentAssets();

    const info = await Promise.all(paymentAssets.map((asset) => this.getTransferInfo(currency, asset, amount)));
    const btcTransfer = info.find((i) => i.method === Blockchain.LIGHTNING && i.asset === 'BTC');
    if (btcTransfer) {
      info.unshift({
        amount: LightningHelper.btcToMsat(btcTransfer.amount),
        asset: 'MSAT',
        method: Blockchain.LIGHTNING,
      });
    }

    return info;
  }

  private async getTransferInfo(currency: Fiat, asset: Asset, amount: number): Promise<TransferInfo> {
    return {
      amount: await this.getTransferAmount(currency, asset, amount),
      asset: asset.name,
      method: asset.blockchain,
    };
  }

  private async getTransferAmount(currency: Fiat, asset: Asset, amount: number): Promise<number> {
    if (currency.name === 'CHF' && asset.name === 'ZCHF') return amount;

    const price = await this.pricingService.getPrice(asset, currency, false);
    return price.invert().convert(amount / (1 - Config.payment.fee), 8);
  }

  private async save(
    dto: CreatePaymentLinkPaymentDto,
    currency: Fiat,
    paymentLink: PaymentLink,
  ): Promise<PaymentLinkPayment> {
    const payment = this.paymentLinkPaymentRepo.create({
      amount: dto.amount,
      externalId: dto.externalId,
      expiryDate: dto.expiryDate ?? Util.secondsAfter(Config.payment.timeout),
      mode: dto.mode,
      currency,
      uniqueId: Util.createUniqueId(PaymentLinkPaymentService.PREFIX_UNIQUE_ID),
      transferAmounts: await this.createTransferInfo(currency, dto.amount).then(JSON.stringify),
      status: PaymentLinkPaymentStatus.PENDING,
      link: paymentLink,
    });

    return this.paymentLinkPaymentRepo.save(payment);
  }

  async complete(payment: PaymentLinkPayment): Promise<PaymentLinkPayment> {
    return this.paymentLinkPaymentRepo.save(payment.complete());
  }
}
