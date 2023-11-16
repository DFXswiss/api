import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName, KycStepStatus } from '../enums/kyc.enum';
import { KycStepDto } from './kyc-info.dto';

export class KycStepMapper {
  static entityToDto(kycStep: KycStep): KycStepDto {
    const dto: KycStepDto = {
      name: kycStep.name,
      type: kycStep.type,
      status: kycStep.status,
      sequenceNumber: kycStep.sequenceNumber,
    };

    return Object.assign(new KycStepDto(), dto);
  }

  static entitiesToDto(userData: UserData): KycStepDto[] {
    const steps = userData.kycSteps.map(KycStepMapper.entityToDto);

    // add open steps
    const openSteps: KycStepDto[] = KycStepMapper.getDefaultSteps().map((s) => ({
      name: s,
      status: KycStepStatus.NOT_STARTED,
      sequenceNumber: -1,
    }));

    return KycStepMapper.sortSteps(steps.concat(openSteps));
  }

  // --- HELPER METHODS --- //
  static getDefaultSteps(): KycStepName[] {
    return [KycStepName.USER_DATA, KycStepName.IDENT, KycStepName.FINANCIAL];
  }

  static sortSteps(steps: KycStepDto[]): KycStepDto[] {
    // group by step and get step with highest sequence number
    const groupedSteps = Util.groupByAccessor(steps, (s) => `${s.name}-${s.type}`);
    const visibleSteps = Array.from(groupedSteps.values()).map((steps) => Util.maxObj(steps, 'sequenceNumber'));

    return visibleSteps.sort((a, b) => this.getStepIndex(a) - this.getStepIndex(b));
  }

  private static getStepIndex(step: KycStepDto): number {
    return Object.values(KycStepName).indexOf(step.name);
  }
}
