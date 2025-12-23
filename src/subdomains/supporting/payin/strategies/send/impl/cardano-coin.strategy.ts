import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CryptoInput, PayInStatus } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInCardanoService } from '../../../services/payin-cardano.service';
import { CardanoStrategy } from './base/cardano.strategy';
import { SendType } from './base/send.strategy';

@Injectable()
export class CardanoCoinStrategy extends CardanoStrategy {
  protected readonly logger = new DfxLogger(CardanoCoinStrategy);

  constructor(payInCardanoService: PayInCardanoService, payInRepo: PayInRepository) {
    super(payInCardanoService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected async checkPreparation(_payIn: CryptoInput): Promise<boolean> {
    /**
     * @note
     * prepared by default, because fee is subtracted from sent amount
     */
    return true;
  }

  protected async prepareSend(payIn: CryptoInput, nativeFee: number): Promise<void> {
    const feeAmount = nativeFee;
    const feeAsset = await this.assetService.getNativeAsset(payIn.asset.blockchain);
    const feeAmountChf = feeAmount
      ? await this.pricingService
          .getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY)
          .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
      : null;

    payIn.preparing(null, feeAmount, feeAmountChf);
    payIn.status = PayInStatus.PREPARED;

    await this.payInRepo.save(payIn);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInCardanoService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, type: SendType): Promise<string> {
    const account = Config.blockchain.cardano.walletAccount(payIn.route.deposit.accountIndex);

    const amount = type === SendType.FORWARD ? await this.calcSendingAmount(payIn) : payIn.sendingAmount;

    return this.payInCardanoService.sendNativeCoin(account, payIn.destinationAddress.address, amount);
  }

  private async calcSendingAmount(payIn: CryptoInput): Promise<number> {
    const balance = await this.payInCardanoService.getNativeCoinBalanceForAddress(payIn.address.address);

    return Math.min(payIn.sendingAmount, balance) - payIn.forwardFeeAmount;
  }
}
