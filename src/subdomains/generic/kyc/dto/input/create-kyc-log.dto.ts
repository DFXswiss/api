import { Type } from 'class-transformer';
import { IsDate, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

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
}
