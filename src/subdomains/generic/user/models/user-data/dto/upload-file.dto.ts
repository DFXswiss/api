import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
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
}
