import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

export class CreateDepositDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  count: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PayInType)
  payInType?: PayInType;
}
