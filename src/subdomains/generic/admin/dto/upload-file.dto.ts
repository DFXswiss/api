import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { KycFileType } from '../../kyc/services/kyc-file.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsEnum(KycFileType)
  documentType: KycFileType;

  @IsNotEmpty()
  @IsString()
  originalName: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsString()
  data: string;
}
