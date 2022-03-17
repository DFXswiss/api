import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';
import { KycDocument } from 'src/user/services/spider/dto/spider.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsNumber()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(KycDocument)
  documentType: KycDocument;
}
