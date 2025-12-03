import { Asset } from 'src/shared/models/asset/asset.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance): CustodyAssetBalanceDto {
    return this.map(custodyBalance.asset, custodyBalance.balance);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[]): CustodyAssetBalanceDto[] {
    const groups = Util.groupByAccessor(custodyBalances, (b) => b.asset.name);

    return Array.from(groups.values()).map((g) => {
      const asset = g[0].asset;
      const balance = Util.sumObjValue(g, 'balance');

      return this.map(asset, balance);
    });
  }

  private static map(asset: Asset, balance: number): CustodyAssetBalanceDto {
    const priceInEur = Price.create('EUR', asset.name, asset.approxPriceEur).invert();
    const priceInChf = Price.create('CHF', asset.name, asset.approxPriceChf).invert();
    const priceInUsd = Price.create('USD', asset.name, asset.approxPriceUsd).invert();

    const dto: CustodyAssetBalanceDto = {
      asset: { name: asset.name, description: asset.description },
      balance: Util.roundReadable(balance, AmountType.ASSET),
      price: {
        eur: Util.roundReadable(priceInEur.price, AmountType.FIAT),
        chf: Util.roundReadable(priceInChf.price, AmountType.FIAT),
        usd: Util.roundReadable(priceInUsd.price, AmountType.FIAT),
      },
      value: {
        eur: Util.roundReadable(priceInEur.convert(balance), AmountType.FIAT),
        chf: Util.roundReadable(priceInChf.convert(balance), AmountType.FIAT),
        usd: Util.roundReadable(priceInUsd.convert(balance), AmountType.FIAT),
      },
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }
}
