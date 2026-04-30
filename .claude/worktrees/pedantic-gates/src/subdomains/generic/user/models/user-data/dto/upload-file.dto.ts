import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';

export class UploadFileDto {
  @IsNotEmpty()
  @IsEnum(FileType)
  documentType: FileType;

  @IsOptional()
  @IsEnum(FileSubType)
  documentSubType: FileSubType;

  @IsNotEmpty()
  @IsString()
  originalName: string;

  @IsNotEmpty()
  @IsString()
  contentType: ContentType;

  @IsNotEmpty()
  @IsString()
  data: string;

  @ValidateIf((dto: UploadFileDto) => dto.documentType === FileType.NAME_CHECK)
  @IsNotEmpty()
  @IsNumber()
  kycLogId: number;
}
