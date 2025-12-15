import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInCardanoService } from '../../../services/payin-cardano.service';
import { SendType } from './base/send.strategy';
import { CardanoStrategy } from './base/cardano.strategy';

@Injectable()
export class CardanoTokenStrategy extends CardanoStrategy {
  protected readonly logger = new DfxLogger(CardanoTokenStrategy);

  constructor(payInCardanoService: PayInCardanoService, payInRepo: PayInRepository) {
    super(payInCardanoService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected async checkPreparation(payIn: CryptoInput): Promise<boolean> {
    return this.payInCardanoService.checkTransactionCompletion(payIn.prepareTxId, 0);
  }

  protected async prepareSend(payIn: CryptoInput, nativeFee: number): Promise<void> {
    const feeAmount = nativeFee;
    const prepareTxId = await this.topUpCoin(payIn, feeAmount);

    const feeAsset = await this.assetService.getNativeAsset(payIn.asset.blockchain);
    const feeAmountChf = feeAmount
      ? await this.pricingService
          .getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY)
          .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
      : null;

    payIn.preparing(prepareTxId, feeAmount, feeAmountChf);
    await this.payInRepo.save(payIn);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInCardanoService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, _type: SendType): Promise<string> {
    const account = Config.blockchain.cardano.walletAccount(payIn.route.deposit.accountIndex);

    return this.payInCardanoService.sendToken(account, payIn.destinationAddress.address, payIn.asset, payIn.sendingAmount);
  }
}
