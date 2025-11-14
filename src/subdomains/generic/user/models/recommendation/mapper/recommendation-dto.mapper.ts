import { RecommendationDto } from '../dto/recommendation.dto';
import { Recommendation } from '../recommendation.entity';

export class RecommendationDtoMapper {
  static entityToDto(recommendation: Recommendation): RecommendationDto {
    const dto: RecommendationDto = {
      id: recommendation.id,
      recommendedAlias: recommendation.recommendedAlias,
      recommendedMail: recommendation.recommendedMail,
      isConfirmed: recommendation.isConfirmed,
    };

    return Object.assign(new RecommendationDto(), dto);
  }

  static entitiesToDto(countries: Recommendation[]): RecommendationDto[] {
    return countries.map(RecommendationDtoMapper.entityToDto);
  }
}
