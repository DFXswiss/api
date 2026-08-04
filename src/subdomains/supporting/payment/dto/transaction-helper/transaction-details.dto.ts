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
   * needs it for the deposit destination can reuse it instead of repeating the lookup. Undefined when none
   * was found, or when no lookup ran at all (non-bank transfer, no userData, or an overridden bank).
   *
   * Only a positive result is reusable. A caller must NOT treat undefined as a settled "there is none"
   * and skip its own read before issuing an IBAN: by then this value is a whole getTxDetails old, and a
   * vIBAN issued concurrently in that window would be missed. On the non-EUR issuance path the duplicate
   * that follows is swallowed, so the customer is sent to the shared collection account while holding a
   * personal IBAN, and a provider outage that never happened is logged at ERROR.
   */
  activeVirtualIban?: VirtualIban;
}
