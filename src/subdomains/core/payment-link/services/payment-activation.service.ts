import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { LnBitsWalletPaymentParamsDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { LessThan } from 'typeorm';
import { PaymentLinkEvmPaymentDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentActivationStatus } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentActivationService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentActivationService);

  private walletAddress: string;

  constructor(
    private readonly paymentActivationRepo: PaymentActivationRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly assetService: AssetService,
    private readonly evmRegistryService: EvmRegistryService,
  ) {}

  onModuleInit() {
    this.walletAddress = EvmUtil.createWallet({ seed: Config.blockchain.evm.paymentSeed, index: 0 }).address;
    this.logger.info(`Wallet Address: ${this.walletAddress}`);
  }

  async processPendingActivations(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    const pendingPaymentActivations = await this.paymentActivationRepo.findBy({
      status: PaymentActivationStatus.PENDING,
      expiryDate: LessThan(maxDate),
    });

    for (const pendingPaymentActivation of pendingPaymentActivations) {
      await this.paymentActivationRepo.save(pendingPaymentActivation.expire());
    }
  }

  async isDuplicate(transferInfo: TransferInfo): Promise<boolean> {
    return this.paymentActivationRepo.exists({
      where: {
        status: PaymentActivationStatus.PENDING,
        amount: transferInfo.amount,
        method: transferInfo.method,
      },
    });
  }

  async getLightningPaymentParams(
    paymentLinkPaymentId: string,
    transferInfo: TransferInfo,
  ): Promise<LnBitsWalletPaymentParamsDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(paymentLinkPaymentId);

    const memo = `Payment ID: ${pendingPayment.link.externalId}/${pendingPayment.externalId}`;

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);
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
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(paymentLinkPaymentId);

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);
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

  async saveLightningPaymentRequest(paymentLinkPaymentId: string, pr: string, transferInfo: TransferInfo) {
    const paymentLinkPayment = await this.paymentLinkPaymentService.getPaymentByUniqueId(paymentLinkPaymentId);
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

  async getPaymentByCryptoInput(cryptoInput: CryptoInput): Promise<PaymentLinkPayment | undefined> {
    if (cryptoInput.address.address !== this.walletAddress) return;

    const pendingActivation = await this.paymentActivationRepo.findOne({
      where: {
        amount: cryptoInput.amount,
        asset: cryptoInput.asset,
        status: PaymentActivationStatus.PENDING,
      },
      relations: {
        payment: true,
      },
    });

    if (!pendingActivation)
      throw new NotFoundException(`No pending activation found for crypto input ${cryptoInput.id}`);

    await this.paymentActivationRepo.save(pendingActivation.complete());

    return this.paymentLinkPaymentService.complete(pendingActivation.payment);
  }
}
