import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import {
  KycStepName,
  KycStepStatus,
  KycStepType,
  getKycStepIndex,
  getKycTypeIndex,
  requiredKycSteps,
} from '../../enums/kyc.enum';
import { KycLevelDto, KycSessionDto } from '../output/kyc-info.dto';
import { KycStepMapper } from './kyc-step.mapper';

export class KycInfoMapper {
  static toDto(userData: UserData, withSession: false, currentStep?: KycStep): KycLevelDto;
  static toDto(userData: UserData, withSession: true, currentStep?: KycStep): KycSessionDto;

  static toDto(userData: UserData, withSession: boolean, currentStep?: KycStep): KycLevelDto | KycSessionDto {
    const kycSteps = KycInfoMapper.getUiSteps(userData);
    currentStep ??=
      kycSteps.find((s) => s.status === KycStepStatus.IN_PROGRESS) ??
      kycSteps.find((s) => s.status === KycStepStatus.FAILED);

    const dto: KycLevelDto | KycSessionDto = {
      kycLevel: userData.kycLevelDisplay,
      tradingLimit: userData.tradingLimit,
      twoFactorEnabled: userData.totpSecret != null,
      language: LanguageDtoMapper.entityToDto(userData.language),
      kycSteps: kycSteps.map((s) => KycStepMapper.toStep(s, currentStep)),
      currentStep: withSession && currentStep ? KycStepMapper.toStepSession(currentStep) : undefined,
    };

    return Object.assign(new KycSessionDto(), dto);
  }

  // --- HELPER METHODS --- //
  private static getUiSteps(userData: UserData): KycStep[] {
    if (userData.isKycTerminated) return [];

    // add open steps
    const openSteps: KycStep[] = requiredKycSteps().map((s) =>
      Object.assign(new KycStep(), {
        name: s,
        status: KycStepStatus.NOT_STARTED,
        sequenceNumber: -1,
      }),
    );

    return KycInfoMapper.sortSteps(
      userData.kycSteps.filter((s) => s.status !== KycStepStatus.CANCELED).concat(openSteps),
    );
  }

  private static sortSteps(steps: KycStep[]): KycStep[] {
    const hasVideoIdent = steps.some(
      (s) => s.name === KycStepName.IDENT && s.type === KycStepType.VIDEO && s.isCompleted,
    );

    // group by step and get step with highest sequence number
    const groupedSteps = steps
      .filter((s) => !(hasVideoIdent && s.name === KycStepName.IDENT && s.type === KycStepType.AUTO))
      .reduce((map, step) => {
        const key = step.type
          ? `${step.name}-${step.type}`
          : Array.from(map.keys()).find((k) => k.includes(step.name)) ?? `${step.name}`;

        return map.set(key, (map.get(key) ?? []).concat(step));
      }, new Map<string, KycStep[]>());
    const visibleSteps = Array.from(groupedSteps.values()).map((steps) => Util.maxObj(steps, 'sequenceNumber'));

    return visibleSteps.sort((a, b) => {
      return getKycStepIndex(a.name) - getKycStepIndex(b.name) || getKycTypeIndex(a.type) - getKycTypeIndex(b.type);
    });
  }
}
