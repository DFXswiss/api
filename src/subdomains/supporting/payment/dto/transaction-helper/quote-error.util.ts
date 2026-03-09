import { QuoteError } from './quote-error.enum';
import { StructuredErrorDto } from './structured-error.dto';

interface ErrorQuote {
  feeAmount: number;
  amount: number;
  estimatedAmount: number;
  exchangeRate: number;
  rate: number;
  minVolume: number;
  maxVolume: number;
  minVolumeTarget: number;
  maxVolumeTarget: number;
  fees: { rate: number; fixed: number; network: number; min: number; dfx: number; bank: number; total: number };
  feesTarget: { rate: number; fixed: number; network: number; min: number; dfx: number; bank: number; total: number };
  priceSteps: [];
  isValid: false;
  error: QuoteError;
  errors: StructuredErrorDto[];
}

export class QuoteException extends Error {
  constructor(public readonly error: QuoteError) {
    super(error);
    this.name = 'QuoteException';
  }
}

export class QuoteErrorUtil {
  static mapToStructuredErrors(
    error: QuoteError | undefined,
    minVolume?: number,
    minVolumeTarget?: number,
    maxVolume?: number,
    maxVolumeTarget?: number,
  ): StructuredErrorDto[] {
    if (!error) return [];

    switch (error) {
      case QuoteError.NATIONALITY_NOT_ALLOWED:
        return [{ error: QuoteError.REGION_RESTRICTED }];

      case QuoteError.AMOUNT_TOO_LOW:
        return [{ error: 'UnderLimitError', sourceAmountLimit: minVolume, destinationAmountLimit: minVolumeTarget }];

      case QuoteError.AMOUNT_TOO_HIGH:
      case QuoteError.LIMIT_EXCEEDED:
        return [{ error: 'OverLimitError', sourceAmountLimit: maxVolume, destinationAmountLimit: maxVolumeTarget }];

      default:
        return [{ error }];
    }
  }

  static createErrorQuote(error: QuoteError | QuoteException): ErrorQuote {
    const quoteError = error instanceof QuoteException ? error.error : error;
    const emptyFee = { rate: 0, fixed: 0, network: 0, min: 0, dfx: 0, bank: 0, total: 0 };

    return {
      feeAmount: 0,
      amount: 0,
      estimatedAmount: 0,
      exchangeRate: 0,
      rate: 0,
      minVolume: 0,
      maxVolume: 0,
      minVolumeTarget: 0,
      maxVolumeTarget: 0,
      fees: emptyFee,
      feesTarget: emptyFee,
      priceSteps: [],
      isValid: false,
      error: quoteError,
      errors: this.mapToStructuredErrors(quoteError),
    };
  }
}
