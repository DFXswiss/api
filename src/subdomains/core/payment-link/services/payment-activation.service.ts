import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { LnBitsWalletPaymentParamsDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkEvmPaymentDto, PaymentLinkPaymentStatus, TransferInfo } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';

@Injectable()
export class PaymentActivationService {
  constructor(
    private readonly paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    private readonly paymentActivationRepo: PaymentActivationRepository,
    private readonly assetService: AssetService,
    private readonly evmRegistryService: EvmRegistryService,
  ) {}

  async isDuplicate(paymentLinkPaymentId: string, transferInfo: TransferInfo): Promise<boolean> {
    return this.paymentActivationRepo.exists({
      where: {
        status: PaymentActivationStatus.PENDING,
        amount: transferInfo.amount,
        method: transferInfo.method,
        payment: { uniqueId: paymentLinkPaymentId },
      },
    });
  }

  async getLightningPaymentParams(
    paymentLinkPaymentId: string,
    transferInfo: TransferInfo,
  ): Promise<LnBitsWalletPaymentParamsDto> {
    const pendingPayment = await this.getPaymentLinkPayment(paymentLinkPaymentId);

    const memo = `Payment ID: ${pendingPayment.link.externalId}/${pendingPayment.externalId}`;

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);

    // TODO: Mit Matthias klären
    // TODO: Wieviele Sekunden sollten hier noch min. übrig sein, damit eine Lightning Invoice erstellt wird?
    if (secondsDiff < 1) throw new BadRequestException(`Payment ${paymentLinkPaymentId} is expired`);

    return {
      amount: LightningHelper.btcToSat(transferInfo.amount),
      memo: memo,
      expirySec: secondsDiff,
    };
  }

  async getPaymentLinkEvmPaymentInfo(
    paymentLinkPaymentId: string,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const pendingPayment = await this.getPaymentLinkPayment(paymentLinkPaymentId);

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);

    // TODO: Mit Matthias klären
    // TODO: Wieviele Sekunden sollten hier noch min. übrig sein, damit eine EVM URI erstellt wird?
    if (secondsDiff < 1) throw new BadRequestException(`Payment ${paymentLinkPaymentId} is expired`);

    const uniqueAssetName = `${transferInfo.method}/${transferInfo.asset}`;
    const asset = await this.assetService.getAssetByUniqueName(uniqueAssetName);
    if (!asset) throw new NotFoundException(`Asset ${uniqueAssetName} not found`);

    const evmService = this.evmRegistryService.getService(transferInfo.method);
    if (!evmService) throw new NotFoundException(`EVM Service ${transferInfo.method} not found`);

    const evmPaymentRequest = await evmService.getPaymentRequest(Config.payment.evmAddress, asset, transferInfo.amount);

    return {
      expiryDate: pendingPayment.expiryDate,
      blockchain: transferInfo.method,
      uri: evmPaymentRequest,
    };
  }

  private async getPaymentLinkPayment(paymentLinkPaymentId: string): Promise<PaymentLinkPayment> {
    const pendingPayments = await this.paymentLinkPaymentRepo.find({
      where: {
        uniqueId: paymentLinkPaymentId,
        status: PaymentLinkPaymentStatus.PENDING,
      },
      relations: {
        link: true,
      },
    });

    if (!pendingPayments.length)
      throw new NotFoundException(`No pending payment found by unique id ${paymentLinkPaymentId}`);

    return pendingPayments[0];
  }

  async saveLightningPaymentRequest(paymentLinkPaymentId: string, pr: string, transferInfo: TransferInfo) {
    const paymentLinkPayment = await this.paymentLinkPaymentRepo.findOneBy({ uniqueId: paymentLinkPaymentId });
    if (!paymentLinkPayment)
      throw new NotFoundException(`No payment link payment found by unique id ${paymentLinkPaymentId}`);

    const uniqueAssetName = `${transferInfo.method}/${transferInfo.asset}`;
    const asset = await this.assetService.getAssetByUniqueName(uniqueAssetName);

    const newPaymentActivation = this.paymentActivationRepo.create({
      status: PaymentActivationStatus.PENDING,
      method: transferInfo.method,
      asset: asset,
      amount: transferInfo.amount,
      paymentRequest: pr,
      expiryDate: paymentLinkPayment.expiryDate,
      payment: paymentLinkPayment,
    });

    await this.paymentActivationRepo.save(newPaymentActivation);
  }
}
