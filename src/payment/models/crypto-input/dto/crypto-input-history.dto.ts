import { AmlCheck } from '../../buy-crypto/enums/aml-check.enum';

export class CryptoInputHistoryDto {
  inputAmount: number;
  inputAsset: string;
  outputAmount: number;
  outputAsset: string;
  txId: string;
  date: Date;
  amlCheck: AmlCheck;
  isComplete: boolean;
}
