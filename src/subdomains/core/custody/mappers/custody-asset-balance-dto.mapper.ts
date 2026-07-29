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
  static mapCustodyBalances(
    custodyBalances: CustodyBalance[],
    interestByAssetName: Map<string, CustodyInterestInfo>,
  ): CustodyAssetBalanceDto[] {
    const groups = Util.groupByAccessor(custodyBalances, (b) => b.asset.name);

    const balances = Array.from(groups.values()).map((g) => {
      const representative = g[0].asset;
      const interestInfo = interestByAssetName.get(representative.name);

      // Quantity is chain-agnostic and stays a single sum over the whole name group, interest
      // included once when present. Fiat value cannot follow the same shortcut: same-named assets
      // on different chains can carry different prices, so folding every line into one sum and
      // pricing it with g[0].asset would value interest (and any other chain's holdings) at an
      // arbitrary representative rate. Sub-group by asset.id instead — interest is computed once
      // per source asset across all custody users of that asset, so it must be attached once per
      // id-group, not once per raw balance row. Each sub-group is priced with its own asset,
      // unrounded fiat amounts are summed, and only the name-group total is rounded once, so the
      // position value stays a faithful sum of its priced components rather than a rounded sum of
      // rounded sub-totals.
      const byAssetId = Util.groupByAccessor(g, (b) => b.asset.id);
      let interestMatched = false;
      let rawValue: CustodyFiatValueDto = { eur: 0, chf: 0, usd: 0 };

      // Interest is folded into the matching source position before that position is priced,
      // rather than added to the fiat value afterwards. This keeps `balance` and `value` derived
      // from the same interest-inclusive amount; `interest` and `interestValue` remain a visible
      // breakdown of that position, not a second addition to it.
      for (const lines of byAssetId.values()) {
        const sourceAsset = lines[0].asset;
        let amount = Util.sumObjValue(lines, 'balance');
        if (interestInfo != null && interestInfo.asset.id === sourceAsset.id) {
          interestMatched = true;
          amount = amount + interestInfo.interest;
        }
        const priced = this.convertToFiatUnrounded(sourceAsset, amount);
        rawValue = {
          eur: rawValue.eur + priced.eur,
          chf: rawValue.chf + priced.chf,
          usd: rawValue.usd + priced.usd,
        };
      }

      if (interestInfo != null && !interestMatched) {
        throw new Error(
          `Interest for asset ${interestInfo.asset.uniqueName} (id ${interestInfo.asset.id}) ` +
            `has no matching balance sub-group in name group '${representative.name}' — ` +
            `interest would appear in balance but not in value`,
        );
      }

      const bookedBalance = Util.sumObjValue(g, 'balance');
      const totalBalance = interestInfo != null ? bookedBalance + interestInfo.interest : bookedBalance;

      return this.buildDto(representative, totalBalance, this.roundFiat(rawValue), interestInfo);
    });

    // The balances arrive in whatever order the database returned them — nothing orders that
    // query — so the same holdings could come back in a different order on every request, with
    // the list visibly reshuffling for no reason. Largest position first is both stable and the
    // order someone reading a portfolio expects; equal values fall back to the name so the
    // result is fully determined.
    //
    // A non-finite value is ranked last rather than compared. NaN is the reason: it makes every
    // difference falsy, which would send the pair to the name comparison and cost the ordering
    // its transitivity — the very unpredictability this sort exists to remove. Infinities are
    // ranked the same way, not because they break the comparison but because they are the same
    // class of corrupted data: no legitimate calculation produces one here, only an already
    // broken balance can, and calculateAccruedInterest treats every non-finite figure alike for
    // exactly that reason. It is not thrown, for the reason recorded there too: one damaged
    // position must not take the customer's whole balance response down with it.
    const rank = (value: number): number => (Number.isFinite(value) ? value : -Infinity);

    return balances.sort((a, b) => rank(b.value.chf) - rank(a.value.chf) || a.asset.name.localeCompare(b.asset.name));
  }

  // Keep DTO assembly in one helper so both public mapping paths apply the same fields and
  // rounding rules; separate construction sites could otherwise drift apart again.
  private static buildDto(
    asset: Asset,
    balance: number,
    value: CustodyFiatValueDto,
    interestInfo?: CustodyInterestInfo,
  ): CustodyAssetBalanceDto {
    const dto: CustodyAssetBalanceDto = {
      asset: { name: asset.name, description: asset.description },
      balance: Util.floor(balance, 8),
      value,
    };

    if (interestInfo != null) {
      dto.interest = Util.floor(interestInfo.interest, 8);
      // interestValue is priced with interestInfo.asset because that is the asset the interest
      // actually accrued on — the same source the interest calculation is scoped to.
      dto.interestValue = this.convertToFiat(interestInfo.asset, interestInfo.interest);
    }

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  private static convertToFiatUnrounded(asset: Asset, amount: number): CustodyFiatValueDto {
    const priceInEur = Price.create('EUR', asset.name, asset.approxPriceEur).invert();
    const priceInChf = Price.create('CHF', asset.name, asset.approxPriceChf).invert();
    const priceInUsd = Price.create('USD', asset.name, asset.approxPriceUsd).invert();

    return {
      eur: priceInEur.convert(amount),
      chf: priceInChf.convert(amount),
      usd: priceInUsd.convert(amount),
    };
  }

  private static roundFiat(raw: CustodyFiatValueDto): CustodyFiatValueDto {
    return {
      eur: Util.roundReadable(raw.eur, AmountType.FIAT),
      chf: Util.roundReadable(raw.chf, AmountType.FIAT),
      usd: Util.roundReadable(raw.usd, AmountType.FIAT),
    };
  }

  private static convertToFiat(asset: Asset, amount: number): CustodyFiatValueDto {
    return this.roundFiat(this.convertToFiatUnrounded(asset, amount));
  }
}
