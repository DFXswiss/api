import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { RecommendationCreator, RecommendationType } from '../recommendation.entity';

export enum RecommendationDtoStatus {
  CREATED = 'Created',
  PENDING = 'Pending',
  EXPIRED = 'Expired',
  COMPLETED = 'Completed',
}

export class CreateRecommendationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(Util.trim)
  recommendedMail: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  recommendedAlias: string;
}

export class RecommendationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

  @ApiProperty({ enum: RecommendationDtoStatus })
  status: RecommendationDtoStatus;

  @ApiProperty({ enum: RecommendationCreator })
  creator: RecommendationCreator;

  @ApiProperty({ enum: RecommendationType })
  type: RecommendationType;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  mail?: string;

  @ApiPropertyOptional()
  confirmationDate?: Date;

  @ApiPropertyOptional()
  expirationDate: Date;
}
