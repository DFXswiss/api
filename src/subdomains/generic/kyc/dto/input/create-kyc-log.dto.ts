import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
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
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  userData: UserData;

  @IsOptional()
  @IsEnum(KycLogType)
  type?: KycLogType;

  @IsOptional()
  @IsString()
  file?: string;

  @ValidateIf((d: CreateKycLogDto) => d.file != null)
  @IsNotEmpty()
  @IsString()
  fileName?: string;
}
