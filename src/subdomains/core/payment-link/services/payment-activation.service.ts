import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
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
    private readonly evmRegistryService: EvmRegistryService,
  ) {
    this.client = lightningService.getDefaultClient();
    this.paymentWebhookMessageQueue = new QueueHandler();

    payInWebHookService
      .getLightningTransactionWebhookObservable()
      .subscribe((transaction) => this.processLightningTransactionMessageQueue(transaction));
  }

  onModuleInit() {
    this.walletAddress = EvmUtil.createWallet({ seed: Config.payment.paymentSeed, index: 0 }).address;
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

  async savePaymentRequest(uniqueId: string, pr: string, transferInfo: TransferInfo): Promise<void> {
    const paymentLinkPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!paymentLinkPayment) {
      this.logger.error(`No pending payment found by unique id ${uniqueId}`);
      return;
    }

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
    if (!Util.equalsIgnoreCase(cryptoInput.address?.address, this.walletAddress)) return;

    const pendingPayments = await this.paymentLinkPaymentService.getPendingPaymentsByAsset(
      cryptoInput.asset,
      cryptoInput.amount,
    );

    if (!pendingPayments.length) {
      this.logger.error(`EVM transaction ${cryptoInput.id}: No pending payment found by asset ${cryptoInput.asset.id}`);
      return;
    }

    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(
      pendingPayments[0].uniqueId,
    );

    if (!pendingPayment) {
      this.logger.error(
        `EVM transaction ${cryptoInput.id}: No pending payment found by unique id ${pendingPayments[0].uniqueId}`,
      );
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

    const receviedAmount = LightningHelper.satToBtc(transactionWebhook.transaction.amount);

    await this.updatePendingPayments(pendingPayment, Blockchain.LIGHTNING, receviedAmount);
  }

  private async updatePendingPayments(
    pendingPayment: PaymentLinkPayment,
    blockchain: Blockchain,
    receviedAmount: number,
  ): Promise<PaymentLinkPayment> {
    const allPendingActivations = pendingPayment.activations.filter(
      (a) => a.status === PaymentActivationStatus.PENDING,
    );

    if (!allPendingActivations.length) {
      this.logger.error(`${blockchain} transaction ${pendingPayment.uniqueId}: No pending activations`);
      return;
    }

    const pendingActivation = allPendingActivations.find((a) => a.method === blockchain && a.amount === receviedAmount);

    if (!pendingActivation) {
      this.logger.error(
        `${blockchain} transaction ${pendingPayment.uniqueId}: No pending ${blockchain} activation with amount ${receviedAmount}`,
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
      if (pendingActivation.id !== activationToBeCompleted.id)
        await this.paymentActivationRepo.save(pendingActivation.expire());
    }

    return this.paymentLinkPaymentService.complete(pendingPayment);
  }

  async createPaymentLinkRequest(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto | PaymentLinkEvmPaymentDto> {
    if (await this.isDuplicate(transferInfo))
      throw new ConflictException(
        `Payment ${uniqueId}: Duplicate method ${transferInfo.method} and amount ${transferInfo.amount}`,
      );

    if (transferInfo.method === Blockchain.LIGHTNING) {
      return this.createPaymentLinkLightningPayment(uniqueId, transferInfo);
    }

    return this.createPaymentLinkEvmPayment(uniqueId, transferInfo);
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
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnurlpInvoiceDto> {
    const walletPaymentParams = await this.getLightningPaymentParams(uniqueId, transferInfo);

    const lightningPayment = await this.client.getLnBitsWalletPayment(walletPaymentParams);

    await this.savePaymentRequest(uniqueId, lightningPayment.pr, transferInfo);

    return lightningPayment;
  }

  private async getLightningPaymentParams(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<LnBitsWalletPaymentParamsDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`No pending payment found by unique id ${uniqueId}`);

    const memo = `Payment ID: ${pendingPayment.link.externalId}/${pendingPayment.externalId}`;

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);
    if (secondsDiff < 1) throw new BadRequestException(`Payment ${pendingPayment.uniqueId} is expired`);

    return {
      amount: LightningHelper.btcToSat(transferInfo.amount),
      memo: memo,
      expirySec: secondsDiff,
      webhook: `${Config.url()}/paymentWebhook/transaction-webhook/${uniqueId}`,
    };
  }

  private async createPaymentLinkEvmPayment(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const evmPayment = await this.getPaymentLinkEvmPaymentInfo(uniqueId, transferInfo);

    await this.savePaymentRequest(uniqueId, evmPayment.uri, transferInfo);

    return evmPayment;
  }

  private async getPaymentLinkEvmPaymentInfo(
    uniqueId: string,
    transferInfo: TransferInfo,
  ): Promise<PaymentLinkEvmPaymentDto> {
    const pendingPayment = await this.paymentLinkPaymentService.getPendingPaymentByUniqueId(uniqueId);
    if (!pendingPayment) throw new NotFoundException(`No pending payment found by unique id ${uniqueId}`);

    const secondsDiff = Util.secondsDiff(new Date(), pendingPayment.expiryDate);
    if (secondsDiff < 1) throw new BadRequestException(`Payment ${uniqueId} is expired`);

    const uniqueAssetName = `${transferInfo.method}/${transferInfo.asset}`;
    const asset = await this.assetService.getAssetByUniqueName(uniqueAssetName);
    if (!asset) throw new NotFoundException(`Asset ${uniqueAssetName} not found`);

    const evmService = this.evmRegistryService.getService(transferInfo.method);
    if (!evmService) throw new NotFoundException(`EVM Service ${transferInfo.method} not found`);

    const evmPaymentRequest = await evmService.getPaymentRequest(this.walletAddress, asset, transferInfo.amount);

    return {
      expiryDate: pendingPayment.expiryDate,
      blockchain: transferInfo.method,
      uri: evmPaymentRequest,
    };
  }
}
