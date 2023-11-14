import { IsEnum, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';
import { KycContentType, KycFileType } from '../../../../kyc/services/kyc-file.dto';

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
  nameCheckLogId: number;
}
