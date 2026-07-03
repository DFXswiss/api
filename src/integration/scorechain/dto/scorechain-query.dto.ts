import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainAnalysisType, ScorechainObjectType } from './scorechain.dto';

export class ScorechainScreeningQuery {
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @IsNotEmpty()
  @IsString()
  objectId: string;

  @IsNotEmpty()
  @IsEnum(ScorechainObjectType)
  objectType: ScorechainObjectType;

  @IsOptional()
  @IsEnum(ScorechainAnalysisType)
  analysisType?: ScorechainAnalysisType;
}
