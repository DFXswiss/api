import { Column, Entity } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { ScorechainAnalysisType, ScorechainObjectType } from '../dto/scorechain.dto';

export enum ScorechainScreeningContext {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',
  MANUAL = 'Manual',
}

@Entity()
export class ScorechainScreening extends IEntity {
  @Column({ length: 256 })
  objectType: ScorechainObjectType;

  @Column({ length: 256 })
  objectId: string;

  @Column({ length: 256 })
  blockchain: string; // DFX Blockchain enum value

  @Column({ length: 256 })
  analysisType: ScorechainAnalysisType;

  @Column({ length: 256 })
  context: ScorechainScreeningContext;

  @Column({ type: 'float', nullable: true })
  riskScore?: number;

  @Column({ length: 256, nullable: true })
  severity?: string;

  @Column({ default: false })
  signatureValid: boolean;

  @Column({ length: 256, nullable: true })
  scorechainRef?: string;

  @Column({ type: 'text', nullable: true })
  riskIndicators?: string; // JSON string

  @Column({ type: 'text', nullable: true })
  rawResponse?: string; // JSON string

  // --- JSON GETTERS / SETTERS (canonical DFX pattern, never expose raw string) --- //

  get riskIndicatorData(): unknown | undefined {
    return this.riskIndicators ? JSON.parse(this.riskIndicators) : undefined;
  }

  set riskIndicatorData(data: unknown) {
    this.riskIndicators = data != null ? JSON.stringify(data) : null;
  }

  get rawResponseData(): unknown | undefined {
    return this.rawResponse ? JSON.parse(this.rawResponse) : undefined;
  }

  set rawResponseData(data: unknown) {
    this.rawResponse = data != null ? JSON.stringify(data) : null;
  }
}
