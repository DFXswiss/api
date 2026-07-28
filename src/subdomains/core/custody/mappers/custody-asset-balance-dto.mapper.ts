import { Asset } from 'src/shared/models/asset/asset.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { CustodyAssetBalanceDto, CustodyFiatValueDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

interface CustodyInterestInfo {
  interest: number;
  asset: Asset;
}

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance): CustodyAssetBalanceDto {
    return this.map(custodyBalance.asset, custodyBalance.balance);
  }

  static mapCustodyBalances(
    custodyBalances: CustodyBalance[],
    interestByAssetName: Map<string, CustodyInterestInfo>,
  ): CustodyAssetBalanceDto[] {
    const groups = Util.groupByAccessor(custodyBalances, (b) => b.asset.name);

    const balances = Array.from(groups.values()).map((g) => {
      const asset = g[0].asset;
      const balance = Util.sumObjValue(g, 'balance');
      const interestInfo = interestByAssetName.get(asset.name);

      return this.map(asset, balance, interestInfo);
    });

    // The balances arrive in whatever order the database returned them — nothing orders that
    // query — so the same holdings could come back in a different order on every request, with
    // the list visibly reshuffling for no reason. Largest position first is both stable and the
    // order someone reading a portfolio expects; equal values fall back to the name so the
    // result is fully determined.
    //
    // A non-finite value is ranked last rather than compared: NaN makes every difference falsy,
    // which would send the pair to the name comparison and cost the ordering its transitivity —
    // the very unpredictability this sort exists to remove. It is not thrown for the same reason
    // a broken interest figure is not: one damaged position must not take the customer's whole
    // balance response down with it.
    const rank = (value: number): number => (Number.isFinite(value) ? value : -Infinity);

    return balances.sort((a, b) => rank(b.value.chf) - rank(a.value.chf) || a.asset.name.localeCompare(b.asset.name));
  }

  private static map(asset: Asset, balance: number, interestInfo?: CustodyInterestInfo): CustodyAssetBalanceDto {
    const dto: CustodyAssetBalanceDto = {
      asset: { name: asset.name, description: asset.description },
      balance: Util.floor(balance, 8),
      value: this.convertToFiat(asset, balance),
    };

    if (interestInfo != null) {
      dto.interest = Util.floor(interestInfo.interest, 8);
      // Priced with the asset the interest actually accrued on (interestInfo.asset), not the
      // group representative (`asset` above, arbitrary once a second same-named asset exists
      // on another chain) — the interest calculation itself is already scoped to one specific
      // asset, and its fiat value must be scoped the same way.
      dto.interestValue = this.convertToFiat(interestInfo.asset, interestInfo.interest);
    }

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  private static convertToFiat(asset: Asset, amount: number): CustodyFiatValueDto {
    const priceInEur = Price.create('EUR', asset.name, asset.approxPriceEur).invert();
    const priceInChf = Price.create('CHF', asset.name, asset.approxPriceChf).invert();
    const priceInUsd = Price.create('USD', asset.name, asset.approxPriceUsd).invert();

    return {
      eur: Util.roundReadable(priceInEur.convert(amount), AmountType.FIAT),
      chf: Util.roundReadable(priceInChf.convert(amount), AmountType.FIAT),
      usd: Util.roundReadable(priceInUsd.convert(amount), AmountType.FIAT),
    };
  }
}
