import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { LogLevel } from 'src/shared/services/dfx-logger';
import {
  CryptoInput,
  PayInConfirmationType,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInInternetComputerService } from 'src/subdomains/supporting/payin/services/payin-icp.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SendStrategy, SendType } from './send.strategy';

export abstract class InternetComputerStrategy extends SendStrategy {
  constructor(
    protected readonly payInInternetComputerService: PayInInternetComputerService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  // ICP tokens use Reverse Gas Model: fee is paid in the token itself, not in native ICP
  protected async updatePayInWithSendData(
    payIn: CryptoInput,
    type: SendType,
    outTxId: string,
    feeAmount: number = null,
  ): Promise<CryptoInput | null> {
    if (type === SendType.FORWARD) {
      const feeAsset =
        payIn.asset.type === AssetType.TOKEN
          ? payIn.asset
          : await this.assetService.getNativeAsset(payIn.asset.blockchain);
      const feeAmountChf = feeAmount
        ? await this.pricingService
            .getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY)
            .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
        : null;

      return payIn.forward(outTxId, feeAmount, feeAmountChf);
    }

    return super.updatePayInWithSendData(payIn, type, outTxId, feeAmount);
  }

  protected abstract checkPreparation(payIn: CryptoInput): Promise<boolean>;
  protected abstract prepareSend(payIn: CryptoInput, estimatedNativeFee: number): Promise<void>;
  protected abstract sendTransfer(payIn: CryptoInput, type: SendType): Promise<string>;

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        if (payIn.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payIn);

          if (isReady) {
            payIn.status = PayInStatus.PREPARED;
          } else {
            continue;
          }
        }

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payIn.status)) {
          const { feeNativeAsset, feeInputAsset, maxFeeInputAsset } = await this.getEstimatedForwardFee(
            payIn.asset,
            payIn.amount,
            payIn.destinationAddress.address,
          );

          CryptoInput.verifyForwardFee(feeInputAsset, payIn.maxForwardFee, maxFeeInputAsset, payIn.amount);

          await this.prepareSend(payIn, feeNativeAsset);

          continue;
        }

        if (payIn.status === PayInStatus.PREPARED) {
          const outTxId = await this.sendTransfer(payIn, type);
          await this.updatePayInWithSendData(payIn, type, outTxId, payIn.forwardFeeAmount);

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        if (e.message.includes('No maximum fee provided')) continue;

        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(logLevel, `Failed to send ${this.blockchain} input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    for (const payIn of payIns) {
      try {
        if (!payIn.confirmationTxId(direction)) continue;

        const minConfirmations = await this.getMinConfirmations(payIn, direction);

        const isConfirmed = await this.payInInternetComputerService.checkTransactionCompletion(
          payIn.confirmationTxId(direction),
          minConfirmations,
        );

        if (isConfirmed) {
          await this.payInRepo.update(...payIn.confirm(direction, this.forwardRequired));
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }
}
