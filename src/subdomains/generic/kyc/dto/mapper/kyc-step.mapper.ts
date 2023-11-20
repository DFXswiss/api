import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, getKycStepIndex } from '../../enums/kyc.enum';
import { KycStepDto } from '../output/kyc-info.dto';

export class KycStepMapper {
  static entityToDto(kycStep: KycStep): KycStepDto {
    const dto: KycStepDto = {
      name: kycStep.name,
      type: kycStep.type ?? undefined,
      status: kycStep.status,
      sequenceNumber: kycStep.sequenceNumber,
      ...kycStep.sessionInfo,
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
  private static getDefaultSteps(): KycStepName[] {
    return [KycStepName.CONTACT_DATA, KycStepName.PERSONAL_DATA, KycStepName.IDENT, KycStepName.FINANCIAL_DATA];
  }

  private static sortSteps(steps: (KycStep | KycStepDto)[]): KycStepDto[] {
    // group by step and get step with highest sequence number
    const groupedSteps = Util.groupByAccessor(steps, (s) => `${s.name}-${s.type}`);
    const visibleSteps = Array.from(groupedSteps.values()).map((steps) => Util.maxObj(steps, 'sequenceNumber'));

    return visibleSteps.sort((a, b) => getKycStepIndex(a.name) - getKycStepIndex(b.name));
  }
}
