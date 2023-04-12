import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

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
        console.warn('Unsupported SendType for updating with send data for pay-in ID', payIn.id);
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
        console.warn('Unsupported SendType for designating send of pay-in ID', payIn.id);
        return null;
    }
  }
}
