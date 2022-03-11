import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';

export class UpdateFileDto {
  @IsNotEmpty()
  @IsNumber()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(KycDocument)
  documentType: KycDocument;
}
