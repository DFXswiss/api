import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CustodyOrderType } from '../../enums/custody';
import { GetCustodyInfoDto } from './get-custody-info.dto';
import { UpdateCustodyOrderInternalDto } from './update-custody-order.dto';

export class CreateCustodyOrderDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(CustodyOrderType)
  type: CustodyOrderType;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => GetCustodyInfoDto)
  custodyInfo: GetCustodyInfoDto;
}

export interface CreateCustodyOrderInternalDto extends UpdateCustodyOrderInternalDto {
  user: User;
  type: CustodyOrderType;
  sell?: Sell;
  swap?: Swap;
  buy?: Buy;
  inputAsset?: Asset;
  inputAmount?: number;
  outputAsset?: Asset;
  outputAmount?: number;
  transactionRequestId?: number;
}
