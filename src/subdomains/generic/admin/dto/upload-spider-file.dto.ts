import { IsEnum, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { KycDocument } from 'src/subdomains/generic/user/services/spider/dto/spider.dto';

export class UploadSpiderFileDto {
  @IsNotEmpty()
  @IsInt()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(KycDocument)
  documentType: KycDocument;

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
