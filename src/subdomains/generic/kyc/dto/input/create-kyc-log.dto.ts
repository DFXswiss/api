import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLogType } from '../../enums/kyc.enum';

export class UpdateKycLogDto {
  @IsOptional()
  @IsString()
  result: string;

  @IsOptional()
  @IsString()
  pdfUrl: string;

  @IsOptional()
  @IsString()
  comment: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  eventDate: Date;
}

export class CreateKycLogDto extends UpdateKycLogDto {
  @IsNotEmpty()
  @IsEnum(KycLogType)
  type: KycLogType;

  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  userData: UserData;
}
