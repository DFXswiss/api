import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { LnBitsWalletPaymentParamsDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LessThan } from 'typeorm';
import { PaymentLinkEvmPaymentDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentRequestMapper } from '../dto/payment-request.mapper';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentActivationStatus } from '../enums';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentActivationService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentActivationService);

  private readonly client: LightningClient;

  private evmDepositAddress: string;

  constructor(
    readonly lightningService: LightningService,
    private readonly paymentActivationRepo: PaymentActivationRepository,
    @Inject(forwardRef(() => PaymentLinkPaymentService))
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly assetService: AssetService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  onModuleInit() {
    this.evmDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
  }

  // --- HANDLE PENDING ACTIVATIONS --- //
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

  getPendingActivation(
    pendingPayment: PaymentLinkPayment,
    blockchain: Blockchain,
    receivedAmount: number,
  ): { pendingActivation: PaymentActivation; allPendingActivations: PaymentActivation[] } | undefined {
    const allPendingActivations = pendingPayment.activations.filter(
      (a) => a.status === PaymentActivationStatus.PENDING,
    );

    if (!allPendingActivations.length) {
      this.logger.error(`${blockchain} transaction ${pendingPayment.id}: No pending activations`);
      return;
    }

    const pendingActivation = allPendingActivations.find((a) => a.method === blockchain && a.amount === receivedAmount);

    if (!pendingActivation) {
      this.logger.error(
        `${blockchain} transaction ${pendingPayment.id}: No pending ${blockchain} activation with amount ${receivedAmount}`,
      );
      return;
    }

    return { pendingActivation, allPendingActivations };
  }

  async updatePaymentActivationStatus(
    activationToBeCompleted: PaymentActivation,
    allPendingActivations: PaymentActivation[],
  ): Promise<void> {
    await this.paymentActivationRepo.save(activationToBeCompleted.complete());

    for (const pendingActivation of allPendingActivations) {
      if (pendingActivation.id !== activationToBeCompleted.id) {
        await this.paymentActivationRepo.save(pendingActivation.expire());
      }
    }
  }

  // --- CREATE ACTIVATIONS --- //
  async createPaymentActivationRequest(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`Pending payment not found by id ${uniqueId}`);

    const actualQuote = await this.paymentQuoteService.getActualQuote(pendingPayment.id, transferInfo);
    if (!actualQuote) throw new NotFoundException(`Actual quote not found for payment ${uniqueId}`);

    if (transferInfo.quoteUniqueId) {
      const transferAmount = await this.paymentQuoteService.getAmountFromQuote(actualQuote, transferInfo);

      if (!transferAmount)
        throw new NotFoundException(
          `Transfer amount not found by method ${transferInfo.method} and asset ${transferInfo.asset}`,
        );

      transferInfo.amount = transferAmount;
    }

    const expiryDate = new Date(Math.min(pendingPayment.expiryDate.getTime(), actualQuote.expiryDate.getTime()));

    const expirySec = Util.secondsDiff(new Date(), expiryDate);
    if (expirySec < 1) throw new BadRequestException('Payment is expired');

    let activation = await this.getExistingActivation(transferInfo);

    if (activation && activation.payment.id !== pendingPayment.id)
      throw new ConflictException('Duplicate payment request');

    if (!activation)
      activation = await this.createNewPaymentActivationRequest(pendingPayment, transferInfo, expirySec, expiryDate);

    return PaymentRequestMapper.toPaymentRequest(activation);
  }

  private async getExistingActivation(transferInfo: TransferInfo): Promise<PaymentActivation | null> {
    return this.paymentActivationRepo.findOne({
      where: {
        status: PaymentActivationStatus.PENDING,
        amount: transferInfo.amount,
        method: transferInfo.method,
        asset: { uniqueName: `${transferInfo.method}/${transferInfo.asset}` },
      },
      relations: {
        payment: true,
      },
    });
  }

  private async createNewPaymentActivationRequest(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
    expiryDate: Date,
  ): Promise<PaymentActivation> {
    const request =
      transferInfo.method === Blockchain.LIGHTNING
        ? await this.createLightningRequest(payment, transferInfo, expirySec)
        : await this.createEvmRequest(transferInfo);

    return this.savePaymentActivationRequest(payment, request, transferInfo, expiryDate);
  }

  private async createLightningRequest(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
  ): Promise<string> {
    const lnurlpAddress = await this.getDepositLnurlpAddress(payment);
    if (!lnurlpAddress) throw new BadRequestException('Deposit LNURLp Address not found');

    const uniqueId = payment.uniqueId;
    const uniqueIdSignature = Util.createSign(uniqueId, Config.blockchain.lightning.lnbits.signingPrivKey);

    const walletPaymentParams: LnBitsWalletPaymentParamsDto = {
      amount: LightningHelper.btcToSat(transferInfo.amount),
      memo: payment.displayName,
      expirySec: expirySec,
      webhook: `${Config.url()}/payIn/lnurlpPayment/${uniqueId}`,
      extra: {
        link: lnurlpAddress,
        signature: uniqueIdSignature,
      },
    };

    return this.client.getLnBitsWalletPayment(walletPaymentParams).then((r) => r.pr);
  }

  private async getDepositLnurlpAddress(pendingPayment: PaymentLinkPayment): Promise<string | undefined> {
    try {
      const depositAddress = pendingPayment.link.route.deposit.address;

      if (!depositAddress.startsWith('LNURL')) {
        this.logger.error(
          `Lightning transaction: Deposit address ${depositAddress} is not a LNURL address for payment link ${pendingPayment.link.uniqueId}`,
        );
        return;
      }

      const decodedDepositAddress = LightningHelper.decodeLnurl(depositAddress);
      const paths = decodedDepositAddress.split('/');
      return paths[paths.length - 1];
    } catch (e) {
      this.logger.error(
        `Lightning transaction: Cannot get LNURLp address for payment link ${pendingPayment.link.id}`,
        e,
      );
    }
  }

  private async createEvmRequest(transferInfo: TransferInfo): Promise<string> {
    const asset = await this.getAssetByInfo(transferInfo);

    return EvmUtil.getPaymentRequest(this.evmDepositAddress, asset, transferInfo.amount);
  }

  private async savePaymentActivationRequest(
    payment: PaymentLinkPayment,
    pr: string,
    transferInfo: TransferInfo,
    expiryDate: Date,
  ): Promise<PaymentActivation> {
    const asset = await this.getAssetByInfo(transferInfo);

    const newPaymentActivation = this.paymentActivationRepo.create({
      status: PaymentActivationStatus.PENDING,
      method: transferInfo.method,
      asset: asset,
      amount: transferInfo.amount,
      paymentRequest: pr,
      expiryDate: expiryDate,
      payment: payment,
    });

    return this.paymentActivationRepo.save(newPaymentActivation);
  }

  private async getAssetByInfo(transferInfo: TransferInfo): Promise<Asset> {
    const uniqueName = `${transferInfo.method}/${transferInfo.asset}`;

    const asset = await this.assetService.getAssetByUniqueName(uniqueName);
    if (!asset) throw new NotFoundException(`Asset ${uniqueName} not found`);

    return asset;
  }

  async cancel(paymentId: number): Promise<void> {
    const pendingPayments = await this.paymentActivationRepo.find({
      where: { payment: { id: paymentId }, status: PaymentActivationStatus.PENDING },
    });

    for (const pendingPayment of pendingPayments) {
      await this.paymentActivationRepo.save(pendingPayment.cancel());
    }
  }
}
