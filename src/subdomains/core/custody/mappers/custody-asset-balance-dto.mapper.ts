import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance, currency: Fiat): CustodyAssetBalanceDto {
    const price = Price.create(custodyBalance.asset.name, currency.name, custodyBalance.asset.getFiatPrice(currency));
    const dto: CustodyAssetBalanceDto = {
      asset: { name: custodyBalance.asset.name, description: custodyBalance.asset.description },
      balance: Util.roundReadable(custodyBalance.balance, AmountType.ASSET),
      value: Util.roundReadable(price.convert(custodyBalance.balance), AmountType.ASSET),
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[], currency: Fiat): CustodyAssetBalanceDto[] {
    const groups = Util.groupByAccessor(custodyBalances, (b) => b.asset.name);

    return Array.from(groups.values()).map((g) => {
      const asset = g[0].asset;
      const price = Price.create(asset.name, currency.name, asset.getFiatPrice(currency));
      const balance = Util.sumObjValue(g, 'balance');

      const dto: CustodyAssetBalanceDto = {
        asset: { name: asset.name, description: asset.description },
        balance: Util.roundReadable(balance, AmountType.ASSET),
        value: Util.roundReadable(price.convert(balance), AmountType.FIAT),
      };

      return Object.assign(new CustodyAssetBalanceDto(), dto);
    });
  }
}
