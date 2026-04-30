import { Buy } from '../../buy-crypto/routes/buy/buy.entity';
import { Swap } from '../../buy-crypto/routes/swap/swap.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';

export class CreateRouteDto {
  buy?: Buy;
  sell?: Sell;
  swap?: Swap;
}
