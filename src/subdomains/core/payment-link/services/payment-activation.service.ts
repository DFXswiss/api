import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { LnBitsWalletPaymentParamsDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Equal, LessThan, Not } from 'typeorm';
import { TransferInfo } from '../dto/payment-link.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import { PaymentActivationStatus, PaymentLinkPaymentMode, PaymentStandard } from '../enums';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentActivationService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentActivationService);

  private readonly client: LightningClient;

  private evmDepositAddress: string;
  private moneroDepositAddress: string;
  private bitcoinDepositAddress: string;

  constructor(
    readonly lightningService: LightningService,
    private readonly paymentActivationRepo: PaymentActivationRepository,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly assetService: AssetService,
    private readonly cryptoService: CryptoService,
  ) {
    this.client = lightningService.getDefaultClient();
  }

  onModuleInit() {
    this.evmDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
    this.moneroDepositAddress = Config.payment.moneroAddress;
    this.bitcoinDepositAddress = Config.payment.bitcoinAddress;
  }

  async close(activation: PaymentActivation): Promise<void> {
    await this.paymentActivationRepo.update(
      { id: activation.id, status: Not(PaymentActivationStatus.CLOSED) },
      { status: PaymentActivationStatus.CLOSED },
    );
  }

  async closeAllForPayment(paymentId: number): Promise<void> {
    await this.paymentActivationRepo.update(
      { payment: { id: paymentId }, status: Not(PaymentActivationStatus.CLOSED) },
      { status: PaymentActivationStatus.CLOSED },
    );
  }

  async closeAllForQuote(quoteId: number): Promise<void> {
    await this.paymentActivationRepo.update(
      { quote: { id: quoteId }, status: Not(PaymentActivationStatus.CLOSED) },
      { status: PaymentActivationStatus.CLOSED },
    );
  }

  async getActivationByTxId(txHash: string): Promise<PaymentActivation | null> {
    return this.paymentActivationRepo.findOne({
      where: { paymentHash: Equal(txHash), status: PaymentActivationStatus.OPEN },
      relations: { quote: { payment: true } },
    });
  }

  // --- HANDLE PENDING ACTIVATIONS --- //
  async processExpiredActivations(): Promise<void> {
    const maxDate = Util.secondsBefore(Config.payment.timeoutDelay);

    await this.paymentActivationRepo.update(
      {
        status: PaymentActivationStatus.OPEN,
        expiryDate: LessThan(maxDate),
      },
      { status: PaymentActivationStatus.CLOSED },
    );
  }

  // --- CREATE ACTIVATIONS --- //

  async doCreateRequest(pendingPayment: PaymentLinkPayment, transferInfo: TransferInfo): Promise<PaymentActivation> {
    const actualQuote = await this.paymentQuoteService.getActualQuote(pendingPayment, transferInfo);
    if (!actualQuote) throw new NotFoundException(`No matching actual quote found`);

    if (transferInfo.quoteUniqueId) {
      const transferAmount = actualQuote.getTransferAmountFor(transferInfo.method, transferInfo.asset)?.amount;

      if (!transferAmount) throw new BadRequestException(`Invalid method or asset`);

      transferInfo.amount = transferAmount;
    }

    const expiryDate = new Date(Math.min(pendingPayment.expiryDate.getTime(), actualQuote.expiryDate.getTime()));

    const expirySec = Util.secondsDiff(new Date(), expiryDate);
    if (expirySec < 1) throw new BadRequestException('Quote is expired');

    const activations = await this.getExistingActivations(transferInfo);
    if (
      actualQuote.standard === PaymentStandard.PAY_TO_ADDRESS &&
      activations.some(
        (a) =>
          a.standard === PaymentStandard.PAY_TO_ADDRESS &&
          (a.quote.id !== actualQuote.id || pendingPayment.mode === PaymentLinkPaymentMode.MULTIPLE),
      )
    )
      throw new ConflictException('Duplicate payment request');

    return (
      activations.find((a) => a.quote.id === actualQuote.id) ??
      this.createNewPaymentActivationRequest(
        pendingPayment,
        actualQuote,
        transferInfo,
        expirySec,
        expiryDate,
        actualQuote.standard,
      )
    );
  }

  private async getExistingActivations(transferInfo: TransferInfo): Promise<PaymentActivation[]> {
    return this.paymentActivationRepo.find({
      where: {
        status: PaymentActivationStatus.OPEN,
        amount: transferInfo.amount,
        method: transferInfo.method,
        asset: { uniqueName: `${transferInfo.method}/${transferInfo.asset}` },
      },
      relations: {
        payment: true,
        quote: true,
      },
    });
  }

  private async createNewPaymentActivationRequest(
    payment: PaymentLinkPayment,
    quote: PaymentQuote,
    transferInfo: TransferInfo,
    expirySec: number,
    expiryDate: Date,
    standard: PaymentStandard,
  ): Promise<PaymentActivation> {
    const { paymentRequest, paymentHash } = await this.createBlockchainRequest(payment, transferInfo, expirySec);

    return this.savePaymentActivationRequest(
      payment,
      quote,
      paymentRequest,
      paymentHash,
      transferInfo,
      expiryDate,
      standard,
    );
  }

  private async createBlockchainRequest(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
  ): Promise<{ paymentRequest: string; paymentHash?: string }> {
    switch (transferInfo.method) {
      case Blockchain.LIGHTNING:
        return this.createLightningRequest(payment, transferInfo, expirySec);

      case Blockchain.BITCOIN:
        return this.createPaymentRequest(this.bitcoinDepositAddress, transferInfo, 'DFX Payment');

      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.POLYGON:
        return this.createPaymentRequest(this.evmDepositAddress, transferInfo);

      case Blockchain.MONERO:
        return this.createPaymentRequest(this.moneroDepositAddress, transferInfo);

      default:
        throw new BadRequestException(`Invalid method ${transferInfo.method}`);
    }
  }

  private async createLightningRequest(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    expirySec: number,
  ): Promise<{ paymentRequest: string; paymentHash: string }> {
    const lnurlpAddress = await this.getDepositLnurlpAddress(payment);
    if (!lnurlpAddress) throw new BadRequestException('Deposit LNURLp Address not found');

    const uniqueId = payment.uniqueId;
    const uniqueIdSignature = Util.createSign(uniqueId, Config.blockchain.lightning.lnbits.signingPrivKey);

    const walletPaymentParams: LnBitsWalletPaymentParamsDto = {
      amount: LightningHelper.btcToSat(transferInfo.amount),
      memo: payment.memo,
      expirySec: expirySec,
      webhook: `${Config.url()}/payIn/lnurlpPayment/${uniqueId}`,
      extra: {
        link: lnurlpAddress,
        signature: uniqueIdSignature,
      },
    };

    const paymentRequest = await this.client.getLnBitsWalletPayment(walletPaymentParams).then((r) => r.pr);
    const paymentHash = LightningHelper.getPaymentHashOfInvoice(paymentRequest);

    return { paymentRequest, paymentHash };
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

  private async createPaymentRequest(
    address: string,
    transferInfo: TransferInfo,
    label?: string,
  ): Promise<{ paymentRequest: string; paymentHash?: string }> {
    const asset = await this.getAssetByInfo(transferInfo);

    const paymentRequest = await this.cryptoService.getPaymentRequest(true, asset, address, transferInfo.amount, label);
    return { paymentRequest };
  }

  private async savePaymentActivationRequest(
    payment: PaymentLinkPayment,
    quote: PaymentQuote,
    paymentRequest: string,
    paymentHash: string,
    transferInfo: TransferInfo,
    expiryDate: Date,
    standard: PaymentStandard,
  ): Promise<PaymentActivation> {
    const asset = await this.getAssetByInfo(transferInfo);

    const newPaymentActivation = this.paymentActivationRepo.create({
      status: PaymentActivationStatus.OPEN,
      method: transferInfo.method,
      amount: transferInfo.amount,
      asset,
      paymentRequest,
      paymentHash,
      expiryDate,
      standard,
      payment,
      quote,
    });

    return this.paymentActivationRepo.save(newPaymentActivation);
  }

  private async getAssetByInfo(transferInfo: TransferInfo): Promise<Asset> {
    const uniqueName = `${transferInfo.method}/${transferInfo.asset}`;

    const asset = await this.assetService.getAssetByUniqueName(uniqueName);
    if (!asset) throw new NotFoundException(`Asset ${uniqueName} not found`);

    return asset;
  }
}
