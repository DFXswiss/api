import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DepositRouteDto } from '../../route/dto/deposit-route.dto';

export class DepositDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  address: string;

  @ApiPropertyOptional({ type: DepositRouteDto })
  route: DepositRouteDto;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;
}
