import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class RecommendationGraphNeighborsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}
