import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { Util } from 'src/shared/utils/util';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName, KycStepNonUserActionable, KycStepRepeatable } from '../../enums/kyc-step-name.enum';
import {
  KycContext,
  KycStepType,
  contextRequiredSteps,
  getKycStepIndex,
  getKycTypeIndex,
  requiredKycSteps,
} from '../../enums/kyc.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycLevelDto, KycProcessStatus, KycSessionDto } from '../output/kyc-info.dto';
import { KycStepMapper } from './kyc-step.mapper';

export class KycInfoMapper {
  static toDto(
    userData: UserData,
    withSession: boolean,
    kycClients: Wallet[],
    currentStep?: KycStep,
    context?: KycContext,
    isMergeProcessing = false,
  ): KycLevelDto | KycSessionDto {
    const kycSteps = KycInfoMapper.getUiSteps(userData);
    // A non-user-actionable step (e.g. DfxApproval, a DFX-side decision) is
    // never the user's `currentStep` — the user has no action to take on it, so
    // surfacing it as current produced a dead-end (blank) screen on the client.
    if (currentStep && KycStepNonUserActionable.includes(currentStep.name)) currentStep = undefined;

    currentStep ??=
      kycSteps.find((s) => s.status === ReviewStatus.IN_PROGRESS && !KycStepNonUserActionable.includes(s.name)) ??
      kycSteps.find((s) => s.status === ReviewStatus.FAILED && !KycStepNonUserActionable.includes(s.name));

    const userKycClients = kycClients.filter((kc) => userData.kycClientList.includes(kc.id));

    const allRequiredSteps = requiredKycSteps(userData);
    const contextSteps = context ? contextRequiredSteps(context) : undefined;
    const requiredStepNames = new Set(
      contextSteps ? allRequiredSteps.filter((s) => contextSteps.has(s)) : allRequiredSteps,
    );

    const dto: KycLevelDto | KycSessionDto = {
      kycLevel: userData.kycLevelDisplay,
      tradingLimit: userData.tradingLimit,
      kycClients: userKycClients.map((kc) => kc.name),
      language: LanguageDtoMapper.entityToDto(userData.language),
      kycSteps: kycSteps.map((s) => KycStepMapper.toStep(s, currentStep, requiredStepNames)),
      processStatus: KycInfoMapper.computeProcessStatus(userData, kycSteps, requiredStepNames, isMergeProcessing),
      currentStep: withSession && currentStep ? KycStepMapper.toStepSession(currentStep) : undefined,
    };

    return withSession ? Object.assign(new KycSessionDto(), dto) : Object.assign(new KycLevelDto(), dto);
  }

  // Reflects the routing semantics the realunit-app currently re-implements
  // locally (`KycCubit._runCheckKyc`): completed vs pending-review vs actionable
  // is derived from the status of the *required* steps, not from `kycLevel`.
  // Surfacing it here lets the client render the verdict without inferring it.
  private static computeProcessStatus(
    userData: UserData,
    kycSteps: KycStep[],
    requiredStepNames: Set<KycStepName>,
    isMergeProcessing: boolean,
  ): KycProcessStatus {
    if (userData.isKycTerminated) return KycProcessStatus.FAILED;
    if (isMergeProcessing) return KycProcessStatus.MERGE_PROCESSING;

    const requiredSteps = kycSteps.filter((s) => requiredStepNames.has(s.name));

    const actionable = new Set<ReviewStatus>([
      ReviewStatus.NOT_STARTED,
      ReviewStatus.IN_PROGRESS,
      ReviewStatus.FAILED,
      ReviewStatus.OUTDATED,
    ]);
    const pending = new Set<ReviewStatus>([
      ReviewStatus.FINISHED,
      ReviewStatus.INTERNAL_REVIEW,
      ReviewStatus.EXTERNAL_REVIEW,
      ReviewStatus.MANUAL_REVIEW,
      ReviewStatus.PARTIALLY_APPROVED,
      ReviewStatus.DATA_REQUESTED,
      ReviewStatus.PAUSED,
      ReviewStatus.ON_HOLD,
    ]);

    // A non-user-actionable step (e.g. DfxApproval) is a backend/DFX-side
    // decision: while open it is "awaiting DFX", never a user action. Treat it
    // as pending-review even when its raw status is in the actionable set, so it
    // can never push the client into the user-actionable IN_PROGRESS lane.
    const isUserActionable = (s: KycStep) => actionable.has(s.status) && !KycStepNonUserActionable.includes(s.name);
    const isPendingReview = (s: KycStep) =>
      pending.has(s.status) || (KycStepNonUserActionable.includes(s.name) && actionable.has(s.status));

    if (requiredSteps.some(isUserActionable)) return KycProcessStatus.IN_PROGRESS;
    if (requiredSteps.some(isPendingReview)) return KycProcessStatus.PENDING_REVIEW;
    return KycProcessStatus.COMPLETED;
  }

  // --- HELPER METHODS --- //
  private static getUiSteps(userData: UserData): KycStep[] {
    if (userData.isKycTerminated) return [];

    // add open steps
    const openSteps: KycStep[] = requiredKycSteps(userData).map((s) =>
      Object.assign(new KycStep(), {
        name: s,
        status: ReviewStatus.NOT_STARTED,
        sequenceNumber: -1,
      }),
    );

    return KycInfoMapper.sortSteps(
      (userData.kycSteps ?? []).filter((s) => s.status !== ReviewStatus.CANCELED).concat(openSteps),
    );
  }

  private static sortSteps(steps: KycStep[]): KycStep[] {
    const completedIdentSteps = steps.filter((s) => s.name === KycStepName.IDENT && s.isCompleted);
    const fullIdentStep =
      completedIdentSteps.find((s) => s.type === KycStepType.MANUAL) ??
      completedIdentSteps.find((s) => s.type === KycStepType.VIDEO || s.type === KycStepType.SUMSUB_VIDEO);

    const groupedSteps = steps
      // hide all other ident steps, if full ident is completed
      .filter((s) => !(s.name === KycStepName.IDENT && fullIdentStep && s.id !== fullIdentStep.id))
      // group by step and get step with highest sequence number
      .reduce((map, step) => {
        const key = step.type
          ? `${step.name}-${step.type.replace('Sumsub', '')}`
          : (Array.from(map.keys()).find((k) => k.includes(step.name)) ?? `${step.name}`);

        return map.set(key, (map.get(key) ?? []).concat(step));
      }, new Map<string, KycStep[]>());

    const visibleSteps = Array.from(groupedSteps.values()).map((steps) => {
      const completedAndInProgressSteps = steps.filter(
        (s) => s.isCompleted || (s.isInProgress && KycStepRepeatable.includes(s.name)),
      );
      return Util.maxObj(completedAndInProgressSteps.length ? completedAndInProgressSteps : steps, 'sequenceNumber');
    });

    return visibleSteps.sort((a, b) => {
      return getKycStepIndex(a.name) - getKycStepIndex(b.name) || getKycTypeIndex(a.type) - getKycTypeIndex(b.type);
    });
  }
}
