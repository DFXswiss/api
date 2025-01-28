import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SpecialCodeType } from '../../entities/special-code.entity';

export class CreateSpecialCodeDto {
  @IsNotEmpty()
  @IsEnum(SpecialCodeType)
  type: SpecialCodeType;

  @IsOptional()
  @IsString()
  code: string;
}
