import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CryptoInput, PayInStatus } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { SendType } from './base/send.strategy';
import { InternetComputerStrategy } from './base/icp.strategy';

@Injectable()
export class InternetComputerCoinStrategy extends InternetComputerStrategy {
  protected readonly logger = new DfxLogger(InternetComputerCoinStrategy);

  constructor(payInInternetComputerService: PayInInternetComputerService, payInRepo: PayInRepository) {
    super(payInInternetComputerService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected async checkPreparation(_payIn: CryptoInput): Promise<boolean> {
    // No preparation needed - fee is subtracted from sent amount (Reverse Gas Model)
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
    return BlockchainAddress.create(this.payInInternetComputerService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, _type: SendType): Promise<string> {
    const amount = await this.calcSendingAmount(payIn);

    return this.payInInternetComputerService.sendNativeCoinFromDepositWallet(
      payIn.route.deposit.accountIndex,
      payIn.destinationAddress.address,
      amount,
    );
  }

  private async calcSendingAmount(payIn: CryptoInput): Promise<number> {
    const balance = await this.payInInternetComputerService.getNativeCoinBalanceForAddress(payIn.address.address);
    const amount = Math.min(payIn.sendingAmount, balance) - payIn.forwardFeeAmount;

    if (amount <= 0) {
      throw new Error(
        `Insufficient coin balance for forward: balance=${balance}, fee=${payIn.forwardFeeAmount}, payIn=${payIn.id}`,
      );
    }

    return amount;
  }
}
