import { RecommendationDto } from '../dto/recommendation.dto';
import { Recommendation } from '../recommendation.entity';

export class RecommendationDtoMapper {
  static entityToDto(recommendation: Recommendation): RecommendationDto {
    const dto: RecommendationDto = {
      id: recommendation.id,
      code: recommendation.code,
      type: recommendation.type,
      name: recommendation.recommended?.completeName ?? recommendation.recommendedAlias,
      mail: recommendation.recommended?.mail ?? recommendation.recommendedMail,
      confirmationDate: recommendation.confirmationDate,
      expirationDate: recommendation.expirationDate,
      isConfirmed: recommendation.isConfirmed,
      isExpired: recommendation.isExpired,
    };

    return Object.assign(new RecommendationDto(), dto);
  }

  static entitiesToDto(recommendations: Recommendation[]): RecommendationDto[] {
    return recommendations.map(RecommendationDtoMapper.entityToDto);
  }
}
