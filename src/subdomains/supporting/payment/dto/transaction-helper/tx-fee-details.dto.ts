import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { FeeDto, InternalFeeDto } from '../fee.dto';

export interface TxFeeDetails {
  minVolume: number;
  fee: InternalFeeDto & FeeDto;
  priceSteps: PriceStep[];
}
