import { QuoteError } from './quote-error.enum';
import { StructuredErrorDto } from './structured-error.dto';

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
}
