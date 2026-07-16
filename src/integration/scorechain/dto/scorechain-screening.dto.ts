import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScorechainAnalysisData,
  ScorechainAnalysisType,
  ScorechainObjectType,
  ScoringAnalysisResponse,
} from './scorechain.dto';
import {
  ScorechainScreening,
  ScorechainScreeningContext,
  ScorechainScreeningTriggerType,
} from '../entities/scorechain-screening.entity';

// Precomputed, per-screening annotations the (service-less, static) mapper cannot derive on its own:
// the advisory high-risk verdict comes from ScorechainScreeningService.isHighRisk, and the related tx
// ids come from the caller's derivation of which of the user's txs produced this screening's objectId.
export interface ScorechainScreeningDtoExtras {
  isHighRisk: boolean;
  relatedBuyCryptoIds?: number[];
  relatedBuyFiatIds?: number[];
}

// Compliance-internal forensic view of a persisted Scorechain screening (@ApiExcludeEndpoint). Including
// the parsed provider analysis (riskIndicatorData) and raw response (rawResponseData) is intentional — the
// same data is already exposed to ADMIN/DEBUG via /gs/debug — and is always serialized through the entity's
// typed getters, never the raw JSON strings.
export class ScorechainScreeningDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  created: Date;

  @ApiProperty({ enum: ScorechainObjectType })
  objectType: ScorechainObjectType;

  @ApiProperty()
  objectId: string;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;

  @ApiProperty({ enum: ScorechainAnalysisType })
  analysisType: ScorechainAnalysisType;

  @ApiProperty({ enum: ScorechainScreeningContext })
  context: ScorechainScreeningContext;

  @ApiProperty({ enum: ScorechainScreeningTriggerType })
  triggerType: ScorechainScreeningTriggerType;

  @ApiPropertyOptional({ description: 'Scorechain quick-check score 1-100 (lower = riskier); absent when no score' })
  riskScore?: number;

  @ApiPropertyOptional({
    description:
      'Either a ScorechainSeverity band (CRITICAL_RISK, HIGH_RISK, MEDIUM_RISK, LOW_RISK, NO_RISK) or one of ' +
      'the sentinels NotSupported (chain not covered), NoCoverage (signed 200 with no analysis coverage) or ' +
      'NotFound (provider 404); absent when never set',
  })
  severity?: string;

  @ApiProperty()
  signatureValid: boolean;

  @ApiProperty({ description: 'Advisory verdict (precomputed): true routes the tx to manual review' })
  isHighRisk: boolean;

  @ApiPropertyOptional({ type: Object, description: 'Parsed provider analysis breakdown (forensic; may be absent)' })
  riskIndicatorData?: ScorechainAnalysisData;

  @ApiPropertyOptional({ type: Object, description: 'Parsed raw provider response (forensic; may be absent)' })
  rawResponseData?: ScoringAnalysisResponse;

  @ApiPropertyOptional({
    type: Number,
    isArray: true,
    description: "BuyCrypto ids of the user's txs backing this screening",
  })
  relatedBuyCryptoIds?: number[];

  @ApiPropertyOptional({
    type: Number,
    isArray: true,
    description: "BuyFiat ids of the user's txs backing this screening",
  })
  relatedBuyFiatIds?: number[];
}

export class ScorechainScreeningDtoMapper {
  static toDto(screening: ScorechainScreening, extras: ScorechainScreeningDtoExtras): ScorechainScreeningDto {
    const dto: ScorechainScreeningDto = {
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

    return dto;
  }

  static toDtoList(
    items: { screening: ScorechainScreening; extras: ScorechainScreeningDtoExtras }[],
  ): ScorechainScreeningDto[] {
    return items.map((item) => ScorechainScreeningDtoMapper.toDto(item.screening, item.extras));
  }
}
