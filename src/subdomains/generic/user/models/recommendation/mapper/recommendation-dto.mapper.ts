import { RecommendationDto, RecommendationDtoStatus } from '../dto/recommendation.dto';
import { Recommendation } from '../recommendation.entity';

export class RecommendationDtoMapper {
  static entityToDto(recommendation: Recommendation): RecommendationDto {
    const dto: RecommendationDto = {
      id: recommendation.id,
      code: recommendation.code,
      status: this.getStatus(recommendation),
      type: recommendation.type,
      name: recommendation.recommended?.completeName ?? recommendation.recommendedAlias,
      mail: recommendation.recommended?.mail ?? recommendation.recommendedMail,
      confirmationDate: recommendation.confirmationDate,
      expirationDate: recommendation.expirationDate,
    };

    return Object.assign(new RecommendationDto(), dto);
  }

  static entitiesToDto(recommendations: Recommendation[]): RecommendationDto[] {
    return recommendations.map(RecommendationDtoMapper.entityToDto);
  }

  static getStatus(recommendation: Recommendation): RecommendationDtoStatus {
    if (recommendation.isConfirmed) return RecommendationDtoStatus.COMPLETED;
    if (recommendation.isExpired) return RecommendationDtoStatus.EXPIRED;
    if (recommendation.isUsed) return RecommendationDtoStatus.PENDING;
    return RecommendationDtoStatus.CREATED;
  }
}
