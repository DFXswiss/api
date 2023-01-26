import { DepositRouteDtoMapper } from '../../route/dto/deposit-route-dto.mapper';
import { Deposit } from '../deposit.entity';
import { DepositDto } from './deposit.dto';

export class DepositDtoMapper {
  static entityToDto(deposit: Deposit): DepositDto {
    const dto: DepositDto = {
      id: deposit.id,
      blockchain: deposit.blockchain,
      address: deposit.address,
      route: deposit.route ? DepositRouteDtoMapper.entityToDto(deposit.route) : undefined,
    };

    return Object.assign(new DepositDto(), dto);
  }

  static entitiesToDto(deposits: Deposit[]): DepositDto[] {
    return deposits.map(DepositDtoMapper.entityToDto);
  }
}
