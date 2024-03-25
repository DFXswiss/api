import { IsEnum, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsEnum(FileType)
  documentType: FileType;

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
