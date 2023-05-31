import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

export type SendGroupKey = string;

export interface SendGroup {
  account: WalletAccount;
  sourceAddress: string;
  destinationAddress: string;
  asset: Asset;
  status: PayInStatus;
  payIns: CryptoInput[];
}

export enum SendType {
  FORWARD = 'Forward',
  RETURN = 'Return',
}

export abstract class SendStrategy {
  protected abstract readonly logger: DfxLogger;

  constructor(
    protected readonly priceProvider: PriceProviderService,
    protected readonly payoutService: PayoutService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  abstract doSend(payIns: CryptoInput[], type: SendType): Promise<void>;
  abstract checkConfirmations(payIns: CryptoInput[]): Promise<void>;

  protected abstract getForwardAddress(): BlockchainAddress;

  protected updatePayInWithSendData(
    payIn: CryptoInput,
    type: SendType,
    outTxId: string,
    feeAmount: number = null,
  ): CryptoInput | null {
    switch (type) {
      case SendType.FORWARD:
        return payIn.forward(outTxId, feeAmount);

      case SendType.RETURN:
        return payIn.return(outTxId);

      default:
        this.logger.warn(`Unsupported SendType for updating with send data for pay-in ${payIn.id}`);
        return null;
    }
  }

  protected designateSend(payIn: CryptoInput, type: SendType): CryptoInput | null {
    switch (type) {
      case SendType.FORWARD:
        return payIn.designateForward(this.getForwardAddress());

      case SendType.RETURN:
        return payIn.designateReturn();

      default:
        this.logger.warn(`Unsupported SendType for designating send of pay-in ${payIn.id}`);
        return null;
    }
  }

  // --- FEES --- //
  protected async getMinInputFee(asset: Asset): Promise<number> {
    return this.transactionHelper.getInSpecs(asset).then((r) => r.minFee);
  }

  protected async getEstimatedFee(asset: Asset): Promise<{ nativeFee: number; targetFee: number }> {
    const nativeFee = await this.payoutService.estimateFee(asset);
    const targetFee = await this.getFeeAmountInPayInAsset(asset, nativeFee);

    return { nativeFee: nativeFee.amount, targetFee };
  }

  private async getFeeAmountInPayInAsset(asset: Asset, nativeFee: FeeResult): Promise<number> {
    return nativeFee.amount ? this.getFeeReferenceAmount(nativeFee.asset, nativeFee.amount, asset) : 0;
  }

  private async getFeeReferenceAmount(fromAsset: Asset, fromAmount: number, toAsset: Asset): Promise<number> {
    const price = await this.priceProvider.getPrice(fromAsset, toAsset);
    return price.convert(fromAmount, 8);
  }
}
