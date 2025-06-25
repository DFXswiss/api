import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInSolanaService } from '../../../services/payin-solana.service';
import { SendType } from './base/send.strategy';
import { SolanaStrategy } from './base/solana.strategy';

@Injectable()
export class SolanaCoinStrategy extends SolanaStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    payInSolanaService: PayInSolanaService,
    payInRepo: PayInRepository,
    readonly loggerFactory: LoggerFactory,
  ) {
    super(payInSolanaService, payInRepo);

    this.logger = this.loggerFactory.create(SolanaCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
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
          .getPrice(feeAsset, this.chf, true)
          .then((p) => p.convert(feeAmount, Config.defaultVolumeDecimal))
      : null;

    payIn.preparing(null, feeAmount, feeAmountChf);
    await this.payInRepo.save(payIn);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(this.payInSolanaService.getWalletAddress(), this.blockchain);
  }

  protected async sendTransfer(payIn: CryptoInput, type: SendType): Promise<string> {
    const account = Config.blockchain.solana.walletAccount(payIn.route.deposit.accountIndex);

    const amount = type === SendType.FORWARD ? await this.calcSendingAmount(payIn) : payIn.sendingAmount;

    return this.payInSolanaService.sendNativeCoin(account, payIn.destinationAddress.address, amount);
  }

  private async calcSendingAmount(payIn: CryptoInput): Promise<number> {
    const balance = await this.payInSolanaService.getNativeCoinBalanceForAddress(payIn.address.address);

    return (
      Math.min(payIn.sendingAmount, balance - Config.blockchain.solana.createTokenAccountFee) - payIn.forwardFeeAmount
    );
  }
}
