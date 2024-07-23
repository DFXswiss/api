import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { LnBitsTransactionWebhookDto, LnBitsWalletPaymentParamsDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { LessThan } from 'typeorm';
import { PayInWebHookService } from '../../../supporting/payin/services/payin-webhhook.service';
import { PaymentLinkEvmPaymentDto, TransferInfo } from '../dto/payment-link.dto';
import { PaymentActivation, PaymentActivationStatus } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentActivationService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentActivationService);

  private readonly client: LightningClient;

  private walletAddress: string;

  private readonly paymentWebhookMessageQueue: QueueHandler;

  constructor(
    readonly lightningService: LightningService,
    readonly payInWebHookService: PayInWebHookService,
    private readonly paymentActivationRepo: PaymentActivationRepository,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly assetService: AssetService,
  ) {
    this.client = lightningService.getDefaultClient();
    this.paymentWebhookMessageQueue = new QueueHandler();

    payInWebHookService
      .getLightningTransactionWebhookObservable()
      .subscribe((transaction) => this.processLightningTransactionMessageQueue(transaction));
  }

  onModuleInit() {
    this.walletAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
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

  async getPaymentByCryptoInput(cryptoInput: CryptoInput): Promise<PaymentLinkPayment | undefined> {
    if (!Util.equalsIgnoreCase(cryptoInput.address?.address, this.walletAddress)) return;

    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByAsset(
      cryptoInput.asset,
      cryptoInput.amount,
    );

    if (!pendingPayment) {
      this.logger.error(`EVM transaction ${cryptoInput.id}: No pending payment found by asset ${cryptoInput.asset.id}`);
      return;
    }

    return this.updatePendingPayments(pendingPayment, cryptoInput.asset.blockchain, cryptoInput.amount);
  }

  private processLightningTransactionMessageQueue(transactionWebhook: LnBitsTransactionWebhookDto) {
    this.paymentWebhookMessageQueue
      .handle<void>(async () => this.processLightningTransaction(transactionWebhook))
      .catch((e) => {
        this.logger.error('Error while processing transaction data', e);
      });
  }

  private async processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): Promise<void> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(
      transactionWebhook.uniqueId,
    );

    if (!pendingPayment) {
      this.logger.error(`Lightning transaction: No pending payment found by unique id ${transactionWebhook.uniqueId}`);
      return;
    }

    const receivedAmount = LightningHelper.satToBtc(transactionWebhook.transaction.amount);

    await this.updatePendingPayments(pendingPayment, Blockchain.LIGHTNING, receivedAmount);
  }

  private async updatePendingPayments(
    pendingPayment: PaymentLinkPayment,
    blockchain: Blockchain,
    receivedAmount: number,
  ): Promise<PaymentLinkPayment> {
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

    return this.doUpdateStatus(pendingActivation, allPendingActivations, pendingPayment);
  }

  private async doUpdateStatus(
    activationToBeCompleted: PaymentActivation,
    allPendingActivations: PaymentActivation[],
    pendingPayment: PaymentLinkPayment,
  ): Promise<PaymentLinkPayment> {
    await this.paymentActivationRepo.save(activationToBeCompleted.complete());

    for (const pendingActivation of allPendingActivations) {
      if (pendingActivation.id !== activationToBeCompleted.id) {
        await this.paymentActivationRepo.save(pendingActivation.expire());
      }
    }

    return this.paymentLinkPaymentService.complete(pendingPayment);
  }

  // --- CREATE ACTIVATIONS --- //
  async createPaymentLinkRequest(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (await this.isDuplicate(transferInfo))
      throw new ConflictException(
        `Duplicate method ${transferInfo.method}, amount ${transferInfo.amount} and asset ${transferInfo.asset}`,
      );

    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`No pending payment found by unique id ${uniqueId}`);

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);
    if (secondsDiff < 1) throw new BadRequestException(`Payment ${pendingPayment.id} is expired`);

    return transferInfo.method === Blockchain.LIGHTNING
      ? this.createPaymentLinkLightningPayment(pendingPayment, transferInfo, secondsDiff)
      : this.createPaymentLinkEvmPayment(pendingPayment, transferInfo);
  }

  private async isDuplicate(transferInfo: TransferInfo): Promise<boolean> {
    return this.paymentActivationRepo.exists({
      where: {
        status: PaymentActivationStatus.PENDING,
        amount: transferInfo.amount,
        method: transferInfo.method,
        asset: { uniqueName: `${transferInfo.method}/${transferInfo.asset}` },
      },
    });
  }

  private async createPaymentLinkLightningPayment(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
  ): Promise<LnurlpInvoiceDto> {
    const walletPaymentParams = await this.getLightningPaymentParams(payment, transferInfo, expirySec);

    const lightningPayment = await this.client.getLnBitsWalletPayment(walletPaymentParams);

    await this.savePaymentRequest(payment, lightningPayment.pr, transferInfo);

    return lightningPayment;
  }

  private async getLightningPaymentParams(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
  ): Promise<LnBitsWalletPaymentParamsDto> {
    const memo = `Payment ID: ${payment.link.externalId}/${payment.externalId}`;

    return {
      amount: LightningHelper.btcToSat(transferInfo.amount),
      memo: memo,
      expirySec: expirySec,
      webhook: `${Config.url()}/paymentWebhook/transaction-webhook/${payment.uniqueId}`,
    };
  }

  private async createPaymentLinkEvmPayment(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const evmPayment = await this.getPaymentLinkEvmPaymentInfo(payment, transferInfo);

    await this.savePaymentRequest(payment, evmPayment.uri, transferInfo);

    return evmPayment;
  }

  private async getPaymentLinkEvmPaymentInfo(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const uniqueAssetName = `${transferInfo.method}/${transferInfo.asset}`;
    const asset = await this.assetService.getAssetByUniqueName(uniqueAssetName);
    if (!asset) throw new NotFoundException(`Asset ${uniqueAssetName} not found`);

    const evmPaymentRequest = EvmUtil.getPaymentRequest(this.walletAddress, asset, transferInfo.amount);

    return {
      expiryDate: payment.expiryDate,
      blockchain: transferInfo.method,
      uri: evmPaymentRequest,
    };
  }

  private async savePaymentRequest(payment: PaymentLinkPayment, pr: string, transferInfo: TransferInfo): Promise<void> {
    const uniqueAssetName = `${transferInfo.method}/${transferInfo.asset}`;
    const asset = await this.assetService.getAssetByUniqueName(uniqueAssetName);

    const newPaymentActivation = this.paymentActivationRepo.create({
      status: PaymentActivationStatus.PENDING,
      method: transferInfo.method,
      asset: asset,
      amount: transferInfo.amount,
      paymentRequest: pr,
      expiryDate: payment.expiryDate,
      payment: payment,
    });

    await this.paymentActivationRepo.save(newPaymentActivation);
  }
}
