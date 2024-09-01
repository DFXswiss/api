import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

export class RefundInternalDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  refundUser: User;

  @IsOptional()
  @IsString()
  refundIban: string;

  @IsOptional()
  @IsNumber()
  chargebackAmount: number;
}
