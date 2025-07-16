import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInTronService } from '../../../services/payin-tron.service';
import { SendType } from './base/send.strategy';
import { TronStrategy } from './base/tron.strategy';

@Injectable()
export class TronCoinStrategy extends TronStrategy {
  protected readonly logger = new DfxLogger(TronCoinStrategy);

  constructor(payInTronService: PayInTronService, payInRepo: PayInRepository) {
    super(payInTronService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
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
          .getPrice(feeAsset, PriceCurrency.CHF, true)
          .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
      : null;

    payIn.preparing(null, feeAmount, feeAmountChf);
    await this.payInRepo.save(payIn);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInTronService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, type: SendType): Promise<string> {
    const account = Config.blockchain.tron.walletAccount(payIn.route.deposit.accountIndex);

    const amount = type === SendType.FORWARD ? await this.calcSendingAmount(payIn) : payIn.sendingAmount;

    return this.payInTronService.sendNativeCoin(account, payIn.destinationAddress.address, amount);
  }

  private async calcSendingAmount(payIn: CryptoInput): Promise<number> {
    const balance = await this.payInTronService.getNativeCoinBalanceForAddress(payIn.address.address);

    return Math.min(payIn.sendingAmount, balance) - payIn.forwardFeeAmount;
  }
}
