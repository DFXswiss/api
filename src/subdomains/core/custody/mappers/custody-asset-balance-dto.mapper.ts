import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { AmountType, Util } from 'src/shared/utils/util';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance): CustodyAssetBalanceDto {
    const dto: CustodyAssetBalanceDto = {
      asset: AssetDtoMapper.toDto(custodyBalance.asset),
      balance: Util.roundReadable(custodyBalance.balance, AmountType.ASSET),
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[]): CustodyAssetBalanceDto[] {
    return custodyBalances.map(CustodyAssetBalanceDtoMapper.mapCustodyBalance);
  }
}
