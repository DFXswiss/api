import { AmlCheck } from '../../buy-crypto/enums/aml-check.enum';

export class BuyFiatHistoryDto {
  inputAmount: number;
  inputAsset: string;
  outputAmount: number;
  outputAsset: string;
  txId: string;
  date: Date;
  amlCheck: AmlCheck;
  isComplete: boolean;
}
