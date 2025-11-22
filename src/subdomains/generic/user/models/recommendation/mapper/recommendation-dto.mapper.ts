import { RecommendationDto } from '../dto/recommendation.dto';
import { Recommendation } from '../recommendation.entity';

export class RecommendationDtoMapper {
  static entityToDto(recommendation: Recommendation, forRecommender: boolean): RecommendationDto {
    const dto: RecommendationDto = {
      id: recommendation.id,
      type: recommendation.type,
      name:
        (forRecommender ? recommendation.recommender?.completeName : recommendation.recommended?.completeName) ??
        recommendation.recommendedAlias,
      mail:
        (forRecommender ? recommendation.recommender?.mail : recommendation.recommended?.mail) ??
        recommendation.recommendedMail,
      confirmationDate: recommendation.confirmationDate,
      expirationDate: recommendation.expirationDate,
      isConfirmed: recommendation.isConfirmed,
      isExpired: recommendation.isExpired,
    };

    return Object.assign(new RecommendationDto(), dto);
  }

  static entitiesToDto(recommendations: Recommendation[], forRecommender: boolean): RecommendationDto[] {
    return recommendations.map((r) => RecommendationDtoMapper.entityToDto(r, forRecommender));
  }
}
