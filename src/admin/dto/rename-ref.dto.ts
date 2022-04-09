import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ReferenceType } from 'src/user/services/spider/spider.service';

export class RenameRefDto {
  @IsNotEmpty()
  @IsString()
  oldReference: string;

  @IsNotEmpty()
  @IsString()
  newReference: string;

  @IsNotEmpty()
  @IsEnum(ReferenceType)
  referenceType: ReferenceType;
}
