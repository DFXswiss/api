import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { KycDocument } from 'src/user/services/spider/dto/spider.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsString()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(KycDocument)
  documentType: KycDocument;
}
