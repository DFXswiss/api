import { ApiProperty } from '@nestjs/swagger';
import { RouteType } from '../deposit-route.entity';

export class DepositRouteDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: RouteType })
  type: RouteType;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  volume: number;
}
