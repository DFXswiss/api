import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { FeeDto } from '../fee.dto';
import { QuoteError } from './quote-error.enum';

export interface TargetEstimation {
  exchangeRate: number;
  rate: number;
  sourceAmount: number;
  estimatedAmount: number;
  exactPrice: boolean;
  feeSource: FeeDto;
  feeTarget: FeeDto;
}

export interface TransactionDetails extends TargetEstimation {
  minVolume: number;
  minVolumeTarget: number;
  maxVolume: number;
  maxVolumeTarget: number;
  priceSteps: PriceStep[];
  isValid: boolean;
  error?: QuoteError;
}
