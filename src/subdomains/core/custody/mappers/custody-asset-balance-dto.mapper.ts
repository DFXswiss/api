import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance, currency: Fiat): CustodyAssetBalanceDto {
    return this.map(custodyBalance.asset, currency, custodyBalance.balance);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[], currency: Fiat): CustodyAssetBalanceDto[] {
    const groups = Util.groupByAccessor(custodyBalances, (b) => b.asset.name);

    return Array.from(groups.values()).map((g) => {
      const asset = g[0].asset;
      const balance = Util.sumObjValue(g, 'balance');

      return this.map(asset, currency, balance);
    });
  }

  private static map(asset: Asset, currency: Fiat, balance: number) {
    const price = Price.create(currency.name, asset.name, asset.getFiatPrice(currency)).invert();

    const dto: CustodyAssetBalanceDto = {
      asset: { name: asset.name, description: asset.description },
      balance: Util.roundReadable(balance, AmountType.ASSET),
      value: Util.roundReadable(price.convert(balance), AmountType.FIAT),
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }
}
