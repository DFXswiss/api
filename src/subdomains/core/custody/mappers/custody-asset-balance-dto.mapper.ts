import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyBalance } from '../entities/custody-balance.entity';

export class CustodyAssetBalanceDtoMapper {
  static mapCustodyBalance(custodyBalance: CustodyBalance): CustodyAssetBalanceDto {
    const dto: CustodyAssetBalanceDto = {
      asset: AssetDtoMapper.toDto(custodyBalance.asset),
      balance: custodyBalance.balance,
    };

    return Object.assign(new CustodyAssetBalanceDto(), dto);
  }

  static mapCustodyBalances(custodyBalances: CustodyBalance[]): CustodyAssetBalanceDto[] {
    return custodyBalances.map(CustodyAssetBalanceDtoMapper.mapCustodyBalance);
  }
}
