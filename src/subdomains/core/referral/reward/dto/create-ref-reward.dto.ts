import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsObject, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';

export class CreateRefRewardDto {
  @IsNotEmpty()
  @IsNumber()
  amountInEur: number;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  user: User;
}

export class CreateManualRefRewardDto extends CreateRefRewardDto {
  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  linkedSourceTransaction: Transaction;
}
