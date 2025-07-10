import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInTronService } from '../../../services/payin-tron.service';
import { SendType } from './base/send.strategy';
import { TronStrategy } from './base/tron.strategy';

@Injectable()
export class TronTokenStrategy extends TronStrategy {
  protected readonly logger = new DfxLogger(TronTokenStrategy);

  constructor(payInTronService: PayInTronService, payInRepo: PayInRepository) {
    super(payInTronService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected async checkPreparation(payIn: CryptoInput): Promise<boolean> {
    return this.payInTronService.checkTransactionCompletion(payIn.prepareTxId, 0);
  }

  protected async prepareSend(payIn: CryptoInput, nativeFee: number): Promise<void> {
    const feeAmount = nativeFee;
    const prepareTxId = await this.topUpCoin(payIn, feeAmount);

    const feeAsset = await this.assetService.getNativeAsset(payIn.asset.blockchain);
    const feeAmountChf = feeAmount
      ? await this.pricingService
          .getPrice(feeAsset, this.chf, true)
          .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
      : null;

    payIn.preparing(prepareTxId, feeAmount, feeAmountChf);
    await this.payInRepo.save(payIn);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInTronService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, _type: SendType): Promise<string> {
    const account = Config.blockchain.tron.walletAccount(payIn.route.deposit.accountIndex);

    return this.payInTronService.sendToken(account, payIn.destinationAddress.address, payIn.asset, payIn.sendingAmount);
  }
}
