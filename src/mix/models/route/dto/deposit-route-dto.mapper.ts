import { DepositRoute } from '../deposit-route.entity';
import { DepositRouteDto } from './deposit-route.dto';

export class DepositRouteDtoMapper {
  static entityToDto(depositRoute: DepositRoute): DepositRouteDto {
    const dto: DepositRouteDto = {
      id: depositRoute.id,
      type: depositRoute.type,
      active: depositRoute.active,
      volume: depositRoute.volume,
    };

    return Object.assign(new DepositRouteDto(), dto);
  }

  static entitiesToDto(depositRoutes: DepositRoute[]): DepositRouteDto[] {
    return depositRoutes.map(DepositRouteDtoMapper.entityToDto);
  }
}
