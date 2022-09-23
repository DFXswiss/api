import { IsDate, IsEnum, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { LimitRequestDecision } from '../limit-request.entity';

export class UpdateLimitRequestDto {
  @IsOptional()
  @IsString()
  clerk: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  edited: Date;

  @IsOptional()
  @IsEnum(LimitRequestDecision)
  decision: LimitRequestDecision;
}
