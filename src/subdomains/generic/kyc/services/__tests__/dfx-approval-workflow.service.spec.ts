import { createMock } from '@golevelup/ts-jest';
import { Config, ConfigService } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { EntityManager } from 'typeorm';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { KycLevel, KycType, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { FileSubType } from '../../dto/kyc-file.dto';
import { DfxApprovalBlocker } from '../../dto/dfx-approval-status.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycStepRepository } from '../../repositories/kyc-step.repository';
import { DfxApprovalCheckService } from '../dfx-approval-check.service';
import { DfxApprovalDocumentService } from '../dfx-approval-document.service';
import { DfxApprovalWorkflowService } from '../dfx-approval-workflow.service';
import { KycNotificationService } from '../kyc-notification.service';
import { NameCheckService } from '../name-check.service';

describe('DfxApprovalWorkflowService', () => {
  let service: DfxApprovalWorkflowService;
  let stepRepo: jest.Mocked<KycStepRepository>;
  let documentService: jest.Mocked<DfxApprovalDocumentService>;
  let notificationService: jest.Mocked<KycNotificationService>;
  let checkService: jest.Mocked<DfxApprovalCheckService>;
  let settingService: jest.Mocked<SettingService>;

  // Chainable query-builder double: the production code locks through the builder, so the double
  // has to return itself from every chained call.
  function queryBuilder(result: unknown): Record<string, jest.Mock> {
    const builder: Record<string, jest.Mock> = {};
    for (const method of ['leftJoinAndSelect', 'where', 'setLock'])
      builder[method] = jest.fn().mockReturnValue(builder);
    builder.getOne = jest.fn().mockResolvedValue(result);

    return builder;
  }

  // TypeORM emits `FOR UPDATE OF <alias>` unquoted; Postgres folds it to lower case and then fails
  // to match a camelCase alias in the FROM clause.
  function expectLowerCaseLockAlias(builder: Record<string, jest.Mock>): void {
    const tables = builder.setLock.mock.calls[0][2] as string[];
    expect(tables).toEqual(tables.map((table) => table.toLowerCase()));
  }

  function pendingStep(): KycStep {
    const userData = createCustomUserData({
      id: 42,
      accountType: AccountType.PERSONAL,
      kycLevel: KycLevel.LEVEL_40,
      kycFiles: [],
      kycSteps: [],
    });
    const step = Object.assign(new KycStep(), {
      id: 11,
      name: KycStepName.DFX_APPROVAL,
      status: ReviewStatus.MANUAL_REVIEW,
      sequenceNumber: 1,
      userData,
    });
    userData.kycSteps = [step];
    return step;
  }

  beforeEach(() => {
    if (!Config) new ConfigService();
    Config.kyc.dfxApprovalWorkflowEnabled = true;
    stepRepo = createMock<KycStepRepository>();
    Object.defineProperty(stepRepo, 'manager', { value: createMock<EntityManager>() });
    documentService = createMock<DfxApprovalDocumentService>();
    notificationService = createMock<KycNotificationService>();
    checkService = createMock<DfxApprovalCheckService>();
    settingService = createMock<SettingService>();
    settingService.getObjCached.mockResolvedValue([]);
    checkService.evaluatePersonal.mockReturnValue({
      ready: false,
      blockers: [{ code: DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType: FileSubType.RISK_PROFILE }],
    });
    service = new DfxApprovalWorkflowService(
      stepRepo,
      checkService,
      documentService,
      createMock<NameCheckService>(),
      notificationService,
      settingService,
    );
    (stepRepo.manager.find as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    Config.kyc.dfxApprovalWorkflowEnabled = false;
  });

  it('stays inactive until the explicit cutover flag is enabled', async () => {
    Config.kyc.dfxApprovalWorkflowEnabled = false;

    await service.reviewPersonalApprovals();

    expect(stepRepo.find).not.toHaveBeenCalled();
  });

  it('serializes every pending candidate through the cross-instance step lock', async () => {
    const first = pendingStep();
    const second = pendingStep();
    second.id = 12;
    stepRepo.find.mockResolvedValueOnce([first, second]).mockResolvedValue([]);
    const lock = jest.spyOn(service as any, 'withStepLock').mockResolvedValue(undefined);

    await service.reviewPersonalApprovals();

    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenNthCalledWith(1, 11, expect.any(Function));
    expect(lock).toHaveBeenNthCalledWith(2, 12, expect.any(Function));
  });

  it('initializes risk data, creates documents and only then completes and notifies', async () => {
    const step = pendingStep();
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);
    const initialize = jest.spyOn(service as any, 'initializePersonalRiskData').mockResolvedValue(undefined);
    const completedUser = createCustomUserData({ ...step.userData, kycLevel: KycLevel.LEVEL_50 });
    const complete = jest.spyOn(service as any, 'completeIfReady').mockResolvedValue(completedUser);
    (service as any).nameCheckService.hasOpenNameChecks.mockResolvedValue(false);

    await (service as any).processPersonalApproval(step.id);

    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(
      (documentService.generateMissingPersonalDocuments as jest.Mock).mock.invocationCallOrder[0],
    );
    expect((documentService.generateMissingPersonalDocuments as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0],
    );
    expect(notificationService.kycChanged).toHaveBeenCalledWith(completedUser, KycLevel.LEVEL_50);
  });

  it('does not touch documents after the step has already advanced', async () => {
    const step = pendingStep();
    step.status = ReviewStatus.COMPLETED;
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);

    await (service as any).processPersonalApproval(step.id);

    expect(documentService.generateMissingPersonalDocuments).not.toHaveBeenCalled();
    expect(notificationService.kycChanged).not.toHaveBeenCalled();
  });

  it('generates independent documents even while a non-document prerequisite is blocked', async () => {
    const step = pendingStep();
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);
    jest.spyOn(service as any, 'initializePersonalRiskData').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'completeIfReady').mockResolvedValue(undefined);
    (service as any).nameCheckService.hasOpenNameChecks.mockResolvedValue(false);
    checkService.evaluatePersonal.mockReturnValue({
      ready: false,
      blockers: [
        { code: DfxApprovalBlocker.MISSING_BIRTHDAY },
        { code: DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType: FileSubType.RISK_PROFILE },
      ],
    });

    await (service as any).processPersonalApproval(step.id);

    expect(documentService.generateMissingPersonalDocuments).toHaveBeenCalledWith(
      step.userData,
      step,
      step.userData.kycFiles,
      expect.any(Array),
    );
    expect(notificationService.kycChanged).not.toHaveBeenCalled();
  });

  it('selects all six generated documents only when their original Sheet predicates match', () => {
    const step = pendingStep();
    const financialStep = Object.assign(new KycStep(), {
      id: 12,
      name: KycStepName.FINANCIAL_DATA,
      status: ReviewStatus.COMPLETED,
      sequenceNumber: 1,
    });
    Object.assign(step.userData, {
      status: UserDataStatus.ACTIVE,
      kycType: KycType.DFX,
      verifiedName: 'Test User',
      nationality: { name: 'Switzerland' },
      country: { fatfEnable: true },
      highRisk: false,
      kycSteps: [step, financialStep],
    });

    expect((service as any).eligiblePersonalDocuments(step.userData, [])).toEqual(
      expect.arrayContaining([
        FileSubType.GWG_FILE_COVER,
        FileSubType.IDENTIFICATION_FORM,
        FileSubType.DFX_NAME_CHECK,
        FileSubType.CUSTOMER_PROFILE,
        FileSubType.RISK_PROFILE,
        FileSubType.FORM_A,
      ]),
    );
    expect((service as any).eligiblePersonalDocuments(step.userData, [])).toHaveLength(6);

    step.userData.highRisk = true;
    expect((service as any).eligiblePersonalDocuments(step.userData, [])).not.toContain(FileSubType.RISK_PROFILE);
    expect((service as any).eligiblePersonalDocuments(step.userData, [])).toContain(FileSubType.FORM_A);
  });

  it('applies the productive approval defaults atomically when completing a ready case', async () => {
    const step = pendingStep();
    step.userData.depositLimit = 250000;
    step.userData.amlAccountType = 'legacy';
    const manager = stepRepo.manager as unknown as jest.Mocked<EntityManager>;
    (manager.transaction as jest.Mock).mockImplementation((action) => action(manager));
    const stepBuilder = queryBuilder(step);
    (manager.createQueryBuilder as jest.Mock).mockReturnValue(stepBuilder);
    (manager.findOne as jest.Mock).mockResolvedValue(step.userData);
    (manager.exists as jest.Mock).mockResolvedValue(false);
    checkService.evaluatePersonal.mockReturnValue({ ready: true, blockers: [] });

    await (service as any).completeIfReady(step.id);

    // The step is loaded together with its user data: a ManyToOne without eager loading is not
    // populated otherwise, and the completion needs the user data ID.
    expect(stepBuilder.leftJoinAndSelect).toHaveBeenCalledWith('step.userData', 'joinedUserData');
    // Postgres rejects FOR UPDATE on the nullable side of an outer join, so the lock names the step.
    expect(stepBuilder.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['step']);
    expectLowerCaseLockAlias(stepBuilder);

    expect(manager.update).toHaveBeenCalledWith(
      expect.any(Function),
      step.userData.id,
      expect.objectContaining({
        kycLevel: KycLevel.LEVEL_50,
        complexOrgStructure: false,
        highRisk: false,
        depositLimit: 100000,
        amlAccountType: 'natural person',
      }),
    );
  });

  it('locks user data without joining its eager relations', async () => {
    const userData = createCustomUserData({ id: 42, pep: null, highRisk: null, lastNameCheckDate: new Date() });
    const manager = stepRepo.manager as unknown as jest.Mocked<EntityManager>;
    (manager.transaction as jest.Mock).mockImplementation((action) => action(manager));
    const userDataBuilder = queryBuilder(userData);
    (manager.createQueryBuilder as jest.Mock).mockReturnValue(userDataBuilder);

    await (service as any).initializePersonalRiskData(userData, false);

    expect(manager.findOne).not.toHaveBeenCalled();
    expect(userDataBuilder.leftJoinAndSelect).not.toHaveBeenCalled();
    expect(userDataBuilder.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['user_data']);
    expectLowerCaseLockAlias(userDataBuilder);
  });

  it('generates RiskProfile and FormA for accounts without any approval or financial step', async () => {
    const userData = createCustomUserData({
      id: 42,
      accountType: AccountType.PERSONAL,
      status: UserDataStatus.ACTIVE,
      kycType: KycType.DFX,
      kycLevel: KycLevel.LEVEL_30,
      verifiedName: 'Test User',
      highRisk: false,
      country: { fatfEnable: true } as never,
      kycSteps: [],
      kycFiles: [],
    });
    (stepRepo.manager.find as jest.Mock).mockResolvedValueOnce([userData]);
    jest.spyOn(service as any, 'withUserDataLock').mockImplementation((_id, action: any) => action());

    await (service as any).generatePendingRiskAndFormADocuments([]);

    expect(documentService.generateMissingPersonalDocuments).toHaveBeenCalledWith(
      userData,
      undefined,
      userData.kycFiles,
      [FileSubType.FORM_A, FileSubType.RISK_PROFILE],
    );
  });

  it('takes the document exclusions from configuration, never from the source tree', async () => {
    settingService.getObjCached.mockResolvedValue([42]);
    const userData = createCustomUserData({
      id: 42,
      accountType: AccountType.PERSONAL,
      status: UserDataStatus.ACTIVE,
      kycType: KycType.DFX,
      kycLevel: KycLevel.LEVEL_30,
      highRisk: false,
      country: { fatfEnable: true } as never,
    });

    expect((service as any).eligibleRiskAndFormADocuments(userData, [42])).toEqual([]);
    expect((service as any).eligibleRiskAndFormADocuments(userData, [])).toContain(FileSubType.FORM_A);

    await service.reviewPersonalApprovals();

    expect(settingService.getObjCached).toHaveBeenCalledWith('dfxApprovalDocumentExclusions', []);
  });
});
