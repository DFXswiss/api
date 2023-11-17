import { IsEnum, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';
import { KycContentType, KycFileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsEnum(KycFileType)
  documentType: KycFileType;

  @IsNotEmpty()
  @IsString()
  originalName: string;

  @IsNotEmpty()
  @IsString()
  contentType: KycContentType;

  @IsNotEmpty()
  @IsString()
  data: string;

  @ValidateIf((dto: UploadFileDto) => dto.documentType === KycFileType.NAME_CHECK)
  @IsNotEmpty()
  @IsNumber()
  kycLogId: number;
}
