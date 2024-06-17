import { PricingProvider } from '../../services/integration/pricing-provider';
import { PriceSource } from '../entities/price-rule.entity';

export type PricingProviderMap = { [s in PriceSource]: PricingProvider };
