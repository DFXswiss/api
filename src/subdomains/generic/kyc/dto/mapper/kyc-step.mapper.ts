import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName, KycStepStatus, getKycStepIndex, getKycTypeIndex } from '../../enums/kyc.enum';
import { KycStepDto } from '../output/kyc-info.dto';

export class KycStepMapper {
  static entityToDto(kycStep: KycStep): KycStepDto {
    const dto: KycStepDto = {
      name: kycStep.name,
      type: kycStep.type ?? undefined,
      status: kycStep.status,
      sequenceNumber: kycStep.sequenceNumber,
      session: kycStep.sessionInfo,
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

  private static sortSteps(steps: KycStepDto[]): KycStepDto[] {
    // group by step and get step with highest sequence number
    const groupedSteps = steps.reduce((map, step) => {
      const key = step.type
        ? `${step.name}-${step.type}`
        : Array.from(map.keys()).find((k) => k.includes(step.name)) ?? `${step.name}`;

      return map.set(key, (map.get(key) ?? []).concat(step));
    }, new Map<string, KycStepDto[]>());
    const visibleSteps = Array.from(groupedSteps.values()).map((steps) => Util.maxObj(steps, 'sequenceNumber'));

    return visibleSteps.sort((a, b) => {
      return getKycStepIndex(a.name) - getKycStepIndex(b.name) || getKycTypeIndex(a.type) - getKycTypeIndex(b.type);
    });
  }
}
