import { FeeDto } from '../fee.dto';
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
  fees: FeeDto;
  feesTarget: FeeDto;
  priceSteps: [];
  isValid: false;
  /** @deprecated Use `errors` instead */
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
    errors: QuoteError[],
    minVolume?: number,
    minVolumeTarget?: number,
    maxVolume?: number,
    maxVolumeTarget?: number,
  ): StructuredErrorDto[] {
    if (!errors || errors.length === 0) return [];

    return errors.flatMap((error) =>
      this.mapSingleError(error, minVolume, minVolumeTarget, maxVolume, maxVolumeTarget),
    );
  }

  private static mapSingleError(
    error: QuoteError,
    minVolume?: number,
    minVolumeTarget?: number,
    maxVolume?: number,
    maxVolumeTarget?: number,
  ): StructuredErrorDto[] {
    switch (error) {
      case QuoteError.AMOUNT_TOO_LOW:
        return [{ error, limit: minVolume, limitTarget: minVolumeTarget }];

      case QuoteError.AMOUNT_TOO_HIGH:
      case QuoteError.LIMIT_EXCEEDED:
        return [{ error, limit: maxVolume, limitTarget: maxVolumeTarget }];

      default:
        return [{ error }];
    }
  }

  static createErrorQuote(error: QuoteError | QuoteException): ErrorQuote {
    const quoteError = error instanceof QuoteException ? error.error : error;
    const emptyFee: FeeDto = {
      rate: 0,
      fixed: 0,
      network: 0,
      min: 0,
      dfx: 0,
      bank: 0,
      bankFixed: 0,
      bankVariable: 0,
      total: 0,
      platform: 0,
    };

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
      errors: this.mapToStructuredErrors([quoteError]),
    };
  }
}
