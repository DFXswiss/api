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
      balanceInCurrency: Util.roundReadable(price.convert(custodyBalance.balance), AmountType.ASSET),
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[], currency: Fiat): CustodyAssetBalanceDto[] {
    const groups = new Map<string, CustodyAssetBalanceDto>();

    for (const custodyBalance of custodyBalances) {
      const group = groups.get(custodyBalance.asset.name);
      const dto = CustodyAssetBalanceDtoMapper.mapCustodyBalance(custodyBalance, currency);

      groups.set(
        custodyBalance.asset.name,
        group
          ? {
              ...group,
              balance: Util.roundReadable(group.balance + dto.balance, AmountType.ASSET),
              balanceInCurrency: Util.roundReadable(group.balanceInCurrency + dto.balanceInCurrency, AmountType.ASSET),
            }
          : dto,
      );
    }

    return Array.from(groups.values());
  }
}
