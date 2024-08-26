import { Type } from 'class-transformer';
import { IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

export class RefundCryptoInputDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  refundUser: User;

  @IsOptional()
  @IsNumber()
  chargebackAmount: number;
}
