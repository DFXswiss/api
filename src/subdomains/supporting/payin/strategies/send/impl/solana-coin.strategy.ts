import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { SolanaUtil } from 'src/integration/blockchain/solana/SolanaUtil';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInSolanaService } from '../../../services/payin-solana.service';
import { SendType } from './base/send.strategy';
import { SolanaStrategy } from './base/solana.strategy';

@Injectable()
export class SolanaCoinStrategy extends SolanaStrategy {
  protected readonly logger = new DfxLogger(SolanaCoinStrategy);

  constructor(payInSolanaService: PayInSolanaService, payInRepo: PayInRepository) {
    super(payInSolanaService, payInRepo);
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

  protected async getFeeAmount(_payIn: CryptoInput): Promise<number> {
    return this.payInSolanaService.getCurrentGasCostForCoinTransaction();
  }

  protected async sendTransfer(payIn: CryptoInput, type: SendType, feeAmount: number): Promise<string> {
    const account = Config.blockchain.solana.walletAccount(payIn.route.deposit.accountIndex);

    const amount =
      type === SendType.FORWARD
        ? await this.calcSendingAmount(account, payIn.sendingAmount, feeAmount)
        : payIn.sendingAmount;

    return this.payInSolanaService.sendNativeCoin(account, payIn.destinationAddress.address, amount);
  }

  private async calcSendingAmount(account: WalletAccount, sendingAmount: number, feeAmount: number): Promise<number> {
    const wallet = SolanaUtil.createWallet(account);
    const balance = await this.payInSolanaService.getNativeCoinBalanceForAddress(wallet.address);

    return Math.min(sendingAmount, balance - Config.blockchain.solana.createTokenAccountFee) - feeAmount;
  }
}
