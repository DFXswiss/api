import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreening } from '../entities/scorechain-screening.entity';
import { ScorechainScreeningDto, ScorechainScreeningDtoExtras } from './scorechain-screening.dto';
import { ScorechainAnalysisData, ScoringAnalysisResponse } from './scorechain.dto';

export class ScorechainScreeningDtoMapper {
  static toDto(screening: ScorechainScreening, extras: ScorechainScreeningDtoExtras): ScorechainScreeningDto {
    return {
      id: screening.id,
      created: screening.created,
      objectType: screening.objectType,
      objectId: screening.objectId,
      blockchain: screening.blockchain as Blockchain,
      analysisType: screening.analysisType,
      context: screening.context,
      triggerType: screening.triggerType,
      riskScore: screening.riskScore,
      severity: screening.severity,
      signatureValid: screening.signatureValid,
      isHighRisk: extras.isHighRisk,
      riskIndicatorData: screening.riskIndicatorData as ScorechainAnalysisData | undefined,
      rawResponseData: screening.rawResponseData as ScoringAnalysisResponse | undefined,
      relatedBuyCryptoIds: extras.relatedBuyCryptoIds,
      relatedBuyFiatIds: extras.relatedBuyFiatIds,
    };
  }

  static toDtoList(
    items: { screening: ScorechainScreening; extras: ScorechainScreeningDtoExtras }[],
  ): ScorechainScreeningDto[] {
    return items.map((item) => ScorechainScreeningDtoMapper.toDto(item.screening, item.extras));
  }
}
