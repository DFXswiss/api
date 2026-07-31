import { VirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { FeeDto } from '../fee.dto';
import { QuoteError } from './quote-error.enum';

export interface TargetEstimation {
  timestamp: Date;
  exchangeRate: number;
  rate: number;
  sourceAmount: number;
  estimatedAmount: number;
  exactPrice: boolean;
  priceSteps: PriceStep[];
  feeSource: FeeDto;
  feeTarget: FeeDto;
}

export interface TransactionDetails extends TargetEstimation {
  minVolume: number;
  minVolumeTarget: number;
  maxVolume: number;
  maxVolumeTarget: number;
  isValid: boolean;
  /** @deprecated Use `errors` instead */
  error?: QuoteError;
  errors: QuoteError[];
  /**
   * The user's active receiving vIBAN as resolved while picking the receiving bank, so a caller that also
   * needs it for the deposit destination can reuse it instead of repeating the lookup. `null` means the
   * lookup ran and found none; `undefined` means no lookup ran (non-bank transfer, no userData, or an
   * overridden bank) and the caller must resolve it itself.
   */
  activeVirtualIban?: VirtualIban | null;
}
