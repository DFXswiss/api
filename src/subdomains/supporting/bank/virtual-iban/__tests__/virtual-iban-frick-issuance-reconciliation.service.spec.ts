import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DataSource, FindOperator, FindOptionsWhere, Repository } from 'typeorm';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { VirtualIbanFrickIssuanceReconciliationService } from '../virtual-iban-frick-issuance-reconciliation.service';
import { VirtualIbanIssuanceEvent } from '../virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from '../virtual-iban-issuance-intent.entity';
import { CREATE_PATH_REFERENCE_MARKER, MERGE_SUPERSEDED_MARKER, VirtualIbanService } from '../virtual-iban.service';

describe('VirtualIbanFrickIssuanceReconciliationService', () => {
  let service: VirtualIbanFrickIssuanceReconciliationService;
  let eventRepo: { find: jest.Mock };
  let intentRepo: { find: jest.Mock };
  let frickVibanProvider: FrickVibanProvider;
  let notificationService: NotificationService;
  let virtualIbanService: {
    resetStuckFrickIntentForReconciliationOnly: jest.Mock;
    recoverFrickIntentForReconciliation: jest.Mock;
    moveFrickIntentToFallbackForReconciliation: jest.Mock;
    isIbanProtectedFromReconciliationDeactivation: jest.Mock;
  };

  const referenceAccountIban = 'LI32088110105923K000C';
  const bankId = 50;
  const abandonedCreate = 'dfx-viban-abandonedcreate000000001';
  const abandonedRecovery = 'dfx-viban-abandonedrecovery0000001';
  const stuckRequestReference = 'dfx-viban-stuckintent000000000001';

  function event(partial: Partial<VirtualIbanIssuanceEvent> & { nextError: string }): VirtualIbanIssuanceEvent {
    return Object.assign(new VirtualIbanIssuanceEvent(), {
      id: 10,
      intentId: 20,
      userDataId: 30,
      currencyId: 40,
      bankId,
      provider: IbanBankName.FRICK,
      referenceAccountIban,
      referenceAccountReceive: true,
      previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
      previousVirtualIbanId: null,
      nextVirtualIbanId: null,
      previousError: null,
      created: new Date('2026-07-01T12:00:00.000Z'),
      ...partial,
    });
  }

  function intent(
    partial: Partial<VirtualIbanIssuanceIntent> & { requestReference: string },
  ): VirtualIbanIssuanceIntent {
    return Object.assign(new VirtualIbanIssuanceIntent(), {
      id: 100,
      userDataId: 30,
      currencyId: 40,
      bankId,
      provider: IbanBankName.FRICK,
      referenceAccountIban,
      referenceAccountReceive: true,
      status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      externalIban: null,
      error: null,
      updated: new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 1_000,
      ),
      created: new Date('2026-07-01T12:00:00.000Z'),
      ...partial,
    });
  }

  function listingEntry(description: string, overrides: Partial<FrickVirtualIban> = {}): FrickVirtualIban {
    return {
      vban: 'LI11ACTIVE00000000001',
      referenceAccountIban,
      state: FrickVirtualIbanState.ACTIVE,
      createdAt: '2026-07-01T00:00:00Z',
      createdBy: 'synthetic',
      activationApprovals: [],
      deactivationApprovals: [],
      description,
      ...overrides,
    };
  }

  function listingResult(virtualIbans: FrickVirtualIban[], fullyValidated: boolean) {
    const listingStartedAt = new Date();
    return { virtualIbans, fullyValidated, listingStartedAt, listingCompletedAt: new Date() };
  }

  /** Routes Phase-1 (InFlight/Failed) vs completed-intent cleanup (COMPLETED) find calls. */
  function mockIntentFinds(
    phase1Intents: VirtualIbanIssuanceIntent[],
    completedIntents: VirtualIbanIssuanceIntent[] = [],
  ): void {
    intentRepo.find.mockImplementation(async (options?: { where?: FindOptionsWhere<VirtualIbanIssuanceIntent> }) => {
      if (options?.where?.status === VirtualIbanIssuanceIntentStatus.COMPLETED) return completedIntents;
      return phase1Intents;
    });
  }

  beforeEach(async () => {
    eventRepo = { find: jest.fn().mockResolvedValue([]) };
    intentRepo = { find: jest.fn().mockResolvedValue([]) };
    frickVibanProvider = createMock<FrickVibanProvider>();
    notificationService = createMock<NotificationService>();
    virtualIbanService = {
      resetStuckFrickIntentForReconciliationOnly: jest.fn().mockResolvedValue(true),
      recoverFrickIntentForReconciliation: jest
        .fn()
        .mockImplementation(async (_intentId: number, match: { vban: string }) => ({
          kind: 'finalized' as const,
          canonicalIban: match.vban,
        })),
      moveFrickIntentToFallbackForReconciliation: jest.fn().mockResolvedValue(true),
      isIbanProtectedFromReconciliationDeactivation: jest.fn().mockResolvedValue(false),
    };

    jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);
    jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === VirtualIbanIssuanceIntent) return intentRepo as unknown as Repository<VirtualIbanIssuanceIntent>;
        if (entity === VirtualIbanIssuanceEvent) return eventRepo as unknown as Repository<VirtualIbanIssuanceEvent>;
        throw new Error(`Unexpected repository request for ${entity?.name ?? entity}`);
      }),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VirtualIbanFrickIssuanceReconciliationService,
        { provide: DataSource, useValue: dataSource },
        { provide: FrickVibanProvider, useValue: frickVibanProvider },
        { provide: NotificationService, useValue: notificationService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
      ],
    }).compile();

    service = module.get(VirtualIbanFrickIssuanceReconciliationService);
    mockIntentFinds([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers an hourly @DfxCron with the VirtualIbanFrickIssuanceReconciliation process', () => {
    const params: DfxCronParams = Reflect.getMetadata(
      DFX_CRONJOB_PARAMS,
      VirtualIbanFrickIssuanceReconciliationService.prototype.reconcileRetiredIssuanceReferences,
    );
    expect(params.expression).toBe(CronExpression.EVERY_HOUR);
    expect(params.process).toBe(Process.VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION);
    expect(params.timeout).toBe(1800);
  });

  it('silently no-ops when the Frick vIBAN rail is not available', async () => {
    jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

    await service.reconcileRetiredIssuanceReferences();

    expect(intentRepo.find).not.toHaveBeenCalled();
    expect(eventRepo.find).not.toHaveBeenCalled();
    expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('extracts abandoned references from both exact nextError shapes', () => {
    expect(
      service.extractAbandonedReference(
        `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
      ),
    ).toBe(abandonedCreate);
    expect(
      service.extractAbandonedReference(
        `recovery listing found no match under requestReference=${abandonedRecovery}; resetting to Pending with requestReference=dfx-viban-new`,
      ),
    ).toBe(abandonedRecovery);
  });

  describe('Phase 1 — stuck InFlight/Failed intents', () => {
    it('filters historical Yapeal intents before any Bank Frick lookup or provider call', async () => {
      const yapealIntent = intent({
        id: 777,
        bankId: 88,
        provider: IbanBankName.YAPEAL,
        requestReference: 'dfx-yapeal-stranded-intent',
      });
      intentRepo.find.mockImplementation(async (options?: { where?: FindOptionsWhere<VirtualIbanIssuanceIntent> }) =>
        options?.where?.provider === IbanBankName.FRICK ? [] : [yapealIntent],
      );

      await service.reconcileRetiredIssuanceReferences();

      expect(intentRepo.find).toHaveBeenCalledWith({
        where: {
          provider: IbanBankName.FRICK,
          status: expect.any(FindOperator),
        },
      });
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
    });

    it('lists the intent reference-account snapshot even when the current Bank IBAN moved', async () => {
      const snapshottedIban = 'LI00SNAPSHOT0000000000C';
      const currentIban = 'LI00CURRENT00000000000C';
      intentRepo.find.mockResolvedValue([
        intent({ requestReference: stuckRequestReference, referenceAccountIban: snapshottedIban }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).toHaveBeenCalledWith(snapshottedIban);
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalledWith(currentIban);
    });

    it('refuses to send a non-Frick provider snapshot to Bank Frick', async () => {
      intentRepo.find.mockResolvedValue([
        intent({ requestReference: stuckRequestReference, provider: IbanBankName.YAPEAL }),
      ]);

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('automatically recovers when the Frick listing contains the intent requestReference', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 101,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(
        101,
        expect.objectContaining({ description: stuckRequestReference }),
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('ignores malformed listing descriptions while recovering a valid exact match', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 117, requestReference: stuckRequestReference })]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult(
            [
              listingEntry(stuckRequestReference, { vban: 'LI11MALFORMED00000001', description: undefined }),
              listingEntry(stuckRequestReference),
            ],
            true,
          ),
        );

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(
        117,
        expect.objectContaining({ description: stuckRequestReference }),
      );
    });

    it('logs ERROR and continues when automatic recovery fails', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 115, requestReference: stuckRequestReference })]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], true));
      virtualIbanService.recoverFrickIntentForReconciliation.mockRejectedValue(new Error('local finalization failed'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 1: automatic recovery failed for intentId=115',
        expect.any(Error),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not count a raced automatic recovery as completed', async () => {
      mockIntentFinds([intent({ id: 116, requestReference: stuckRequestReference })]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], true));
      virtualIbanService.recoverFrickIntentForReconciliation.mockResolvedValue({ kind: 'not_eligible' });
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(116, expect.anything());
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('recovery not eligible after positive match for intentId=116'),
      );
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('duplicates left untouched'));
    });

    it('finalizes the deterministic winner first, then deactivates duplicates with the intent snapshot', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 130, requestReference: stuckRequestReference })]);
      const newer = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000002', createdAt: '2026-07-02' };
      const older = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000001', createdAt: '2026-07-01' };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([newer, older], true));
      const callOrder: string[] = [];
      virtualIbanService.recoverFrickIntentForReconciliation.mockImplementation(
        async (_id: number, match: { vban: string }) => {
          callOrder.push('recover');
          return { kind: 'finalized' as const, canonicalIban: match.vban };
        },
      );
      jest.spyOn(frickVibanProvider, 'deactivateAndApprove').mockImplementation(async () => {
        callOrder.push('deactivate');
      });
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(callOrder).toEqual(['recover', 'deactivate']);
      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(130, older);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        newer,
        referenceAccountIban,
        stuckRequestReference,
      );
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('positive listing match for InFlight/Failed intent intentId=130'),
      );
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('candidateCount=2'));
    });

    it('uses the vIBAN as deterministic tie-breaker when duplicate timestamps are equal', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 134, requestReference: stuckRequestReference })]);
      const higher = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000002' };
      const lower = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000001' };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([higher, lower], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(134, lower);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        higher,
        referenceAccountIban,
        stuckRequestReference,
      );
    });

    it('never deactivates when a race already finalized a different canonical IBAN', async () => {
      mockIntentFinds([intent({ id: 135, requestReference: stuckRequestReference })]);
      const newer = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000002', createdAt: '2026-07-02' };
      const older = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000001', createdAt: '2026-07-01' };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([newer, older], true));
      virtualIbanService.recoverFrickIntentForReconciliation.mockResolvedValue({
        kind: 'already_finalized',
        canonicalIban: 'LI99OTHER00000000001',
      });
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(135, older);
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('raced different canonical for intentId=135'));
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('candidateCount=2'));
    });

    it('still deactivates duplicates when recovery reports already_finalized with the winner canonical', async () => {
      mockIntentFinds([intent({ id: 142, requestReference: stuckRequestReference })]);
      const newer = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000002', createdAt: '2026-07-02' };
      const older = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000001', createdAt: '2026-07-01' };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([newer, older], true));
      virtualIbanService.recoverFrickIntentForReconciliation.mockResolvedValue({
        kind: 'already_finalized',
        canonicalIban: older.vban,
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(142, older);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        newer,
        referenceAccountIban,
        stuckRequestReference,
      );
    });

    it('logs ERROR and performs no external action on cross-account listing mismatch', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 136, requestReference: stuckRequestReference })]);
      const foreign = {
        ...listingEntry(stuckRequestReference),
        referenceAccountIban: 'LI99FOREIGN0000000000C',
      };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([foreign], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('cross-account listing mismatch for intentId=136'),
      );
      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('no external action'));
    });

    it('returns early from recoverPhase1ListingMatch when virtualIbans is empty', async () => {
      // Productively unreachable via runPhase1StuckIntents (only pushes matches with length > 0).
      // Direct private-helper call covers the empty-candidates guard at line 897.
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);
      const onRecovered = jest.fn();
      const onRecoveryFailure = jest.fn();
      const onDuplicateDeactivated = jest.fn();

      await service['recoverPhase1ListingMatch'](
        {
          intentId: 150,
          requestReference: stuckRequestReference,
          referenceAccountIban,
          userDataId: 30,
          currencyId: 40,
          bankId,
          status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
          updated: new Date('2026-07-01T12:00:00.000Z'),
          virtualIbans: [],
        },
        {
          onRecovered,
          onRecoveryFailure,
          onDuplicateDeactivated,
        },
      );

      expect(loggerError).not.toHaveBeenCalled();
      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(onRecovered).not.toHaveBeenCalled();
      expect(onRecoveryFailure).not.toHaveBeenCalled();
      expect(onDuplicateDeactivated).not.toHaveBeenCalled();
    });

    it('logs PII-safe ERROR for a single Phase-1 positive match before recovery', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 137, requestReference: stuckRequestReference })]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 1: positive listing match for InFlight/Failed intent ' +
          `intentId=137 bankId=${bankId} candidateCount=1`,
      );
      expect(loggerError.mock.calls.flat().join(' ')).not.toMatch(/LI\d{2}/);
      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalled();
    });

    it('does not fall back after failed listing even when the intent is day-old', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 138,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockRejectedValue(new Error('upstream listing unavailable'));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).not.toHaveBeenCalled();
    });

    it('does not fall back after invalid listing timestamps even when the intent is day-old', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 139,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult([], true),
        listingStartedAt: new Date('invalid'),
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).not.toHaveBeenCalled();
    });

    it('does not fall back after incomplete listing even when the intent is day-old', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 140,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).not.toHaveBeenCalled();
      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
    });

    it('leaves remaining duplicates untouched and ERROR-logs when cleanup fails after canonical finalize', async () => {
      mockIntentFinds([intent({ id: 141, requestReference: stuckRequestReference })]);
      const mid = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000002', createdAt: '2026-07-02' };
      const older = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000001', createdAt: '2026-07-01' };
      const newest = { ...listingEntry(stuckRequestReference), vban: 'LI11ACTIVE00000000003', createdAt: '2026-07-03' };
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([newest, mid, older], true));
      jest.spyOn(frickVibanProvider, 'deactivateAndApprove').mockRejectedValueOnce(new Error('deactivation ambiguous'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(141, older);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('duplicate cleanup failed for intentId=141'),
        expect.any(Error),
      );
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('remaining duplicates left for completed-intent cleanup retry'),
        expect.any(Error),
      );
    });

    it('moves a day-old listing miss to the collection-account fallback', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 131,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).toHaveBeenCalledWith(
        131,
        stuckRequestReference,
      );
      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
    });

    it('logs ERROR and continues when the automatic fallback transition fails', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 132,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));
      virtualIbanService.moveFrickIntentToFallbackForReconciliation.mockRejectedValue(
        new Error('fallback transaction failed'),
      );
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 1: automatic fallback transition failed for intentId=132',
        expect.any(Error),
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('accepts a raced fallback transition without treating it as newly completed', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 133,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));
      virtualIbanService.moveFrickIntentToFallbackForReconciliation.mockResolvedValue(false);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).toHaveBeenCalledWith(
        133,
        stuckRequestReference,
      );
    });

    it('skips intents younger than the safety threshold', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 102,
          requestReference: stuckRequestReference,
          updated: new Date(Date.now() - 60_000),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('logs an old inconclusive intent without sending an alert', async () => {
      const pastThresholdUpdated = new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 5_000,
      );
      intentRepo.find.mockResolvedValue([
        intent({
          id: 103,
          requestReference: stuckRequestReference,
          updated: pastThresholdUpdated,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
    });

    it('keeps an old intent inconclusive when the listing began before create processing could end', async () => {
      const updated = new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 5_000,
      );
      const currentReference = 'dfx-viban-listing-too-early-00000001';
      intentRepo.find.mockResolvedValue([
        intent({
          id: 113,
          requestReference: currentReference,
          updated,
        }),
      ]);
      expect(VirtualIbanFrickIssuanceReconciliationService.FRICK_CREATE_MAX_PROCESSING_MS).toBe(120_000);
      const latestPossibleCreateProcessedAt = new Date(updated.getTime() + 120_000);
      const listingStartedAt = new Date(latestPossibleCreateProcessedAt.getTime() - 1);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult([], true),
        listingStartedAt,
        listingCompletedAt: new Date(listingStartedAt.getTime() + 1_000),
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).not.toHaveBeenCalled();
    });

    it('rejects invalid listing timestamps without reopening an intent', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 114, requestReference: stuckRequestReference })]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult([], true),
        listingStartedAt: new Date('invalid'),
      });

      await service.reconcileRetiredIssuanceReferences();
    });

    it('does not mutate a recent intent when listing is not fully validated', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 104,
          requestReference: stuckRequestReference,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
    });

    it('still recovers a positive match when listing is not fully validated', async () => {
      intentRepo.find.mockResolvedValue([
        intent({ id: 105, requestReference: stuckRequestReference }),
        intent({ id: 106, requestReference: 'dfx-viban-other-stuck-ref-00000001' }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledWith(
        105,
        expect.objectContaining({ description: stuckRequestReference }),
      );
      expect(virtualIbanService.recoverFrickIntentForReconciliation).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not send a separate alert for a chronically incomplete listing', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 107,
          requestReference: stuckRequestReference,
          bankId,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not send an alert when incomplete-listing intents are still within the safety threshold', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 108,
          requestReference: stuckRequestReference,
          updated: new Date(Date.now() - 60_000),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('continues Phase 1 for healthy banks when one bank throws without sending an alert', async () => {
      const healthyBankId = 51;
      const healthyRef = 'dfx-viban-healthybankintent0000000001';
      const healthyReferenceAccountIban = 'LI00HEALTHY00000000000C';
      intentRepo.find.mockResolvedValue([
        intent({ id: 110, requestReference: stuckRequestReference, bankId, referenceAccountReceive: false }),
        intent({
          id: 111,
          requestReference: healthyRef,
          bankId: healthyBankId,
          referenceAccountIban: healthyReferenceAccountIban,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('filters merge-superseded FAILED intents and leaves other listing misses non-retryable', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const eligibleReference = 'dfx-viban-eligibleforreset000000000001';
      intentRepo.find.mockResolvedValue([
        intent({
          id: 120,
          requestReference: mergeRetiredReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error:
            `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
            `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
        }),
        intent({
          id: 121,
          requestReference: eligibleReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error: 'create failed for an unrelated reason',
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('skips Phase 1 entirely when every loaded InFlight/Failed intent is merge-superseded', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesupersededonly000000001';
      // Route by status so the Completed-intent pass does not receive Phase-1 rows.
      mockIntentFinds([
        intent({
          id: 122,
          requestReference: mergeRetiredReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error:
            `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
            `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
        }),
      ]);

      await service.reconcileRetiredIssuanceReferences();

      // Filtered out before bank grouping — no listing or reopening work.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('Completed-intent duplicate cleanup', () => {
    const canonicalVban = 'LI11ACTIVE00000000001';
    const duplicateVban = 'LI11ACTIVE00000000002';
    const completedRef = 'dfx-viban-completedcleanup00000000001';

    function completedIntent(
      partial: Partial<VirtualIbanIssuanceIntent> & { requestReference?: string } = {},
    ): VirtualIbanIssuanceIntent {
      return intent({
        id: 500,
        requestReference: completedRef,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
        externalIban: canonicalVban,
        ...partial,
      });
    }

    it('exits early when there are no COMPLETED Frick intents', async () => {
      mockIntentFinds([]);
      const loggerInfo = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerInfo).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation completed-intent cleanup: no COMPLETED Frick intents',
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('ERROR-logs and skips when a COMPLETED intent has no externalIban', async () => {
      mockIntentFinds([], [completedIntent({ externalIban: null })]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('missing externalIban for intentId=500'));
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('ERROR-logs and skips on cross-account listing mismatch', async () => {
      mockIntentFinds([], [completedIntent()]);
      const foreign = {
        ...listingEntry(completedRef, { vban: canonicalVban }),
        referenceAccountIban: 'LI99FOREIGN0000000000C',
      };
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([foreign], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('cross-account listing mismatch for intentId=500'),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('ERROR-logs and skips when the canonical IBAN is absent from a fully validated listing', async () => {
      mockIntentFinds([], [completedIntent()]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(completedRef, { vban: duplicateVban })], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('canonical IBAN not present in fully validated listing for intentId=500'),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('treats a missing requestReference group as an empty listing and performs no external write', async () => {
      // byDescription.get(intent.requestReference) is undefined → production `?? []` at cleanup entry.
      mockIntentFinds([], [completedIntent()]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult([listingEntry('dfx-viban-unrelated-completedcleanup-ref-01', { vban: canonicalVban })], true),
        );
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('canonical IBAN not present in fully validated listing for intentId=500'),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
      expect(virtualIbanService.recoverFrickIntentForReconciliation).not.toHaveBeenCalled();
      expect(virtualIbanService.moveFrickIntentToFallbackForReconciliation).not.toHaveBeenCalled();
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(virtualIbanService.isIbanProtectedFromReconciliationDeactivation).not.toHaveBeenCalled();
    });

    it('deactivates only non-canonical cleanup-target duplicates after a PII-safe ERROR', async () => {
      mockIntentFinds([], [completedIntent()]);
      const canonical = listingEntry(completedRef, { vban: canonicalVban, state: FrickVirtualIbanState.ACTIVE });
      const duplicate = listingEntry(completedRef, {
        vban: duplicateVban,
        state: FrickVirtualIbanState.PREPARED,
        createdAt: '2026-07-02T00:00:00Z',
      });
      const deactivatedOther = listingEntry(completedRef, {
        vban: 'LI11ACTIVE00000000003',
        state: FrickVirtualIbanState.DEACTIVATED,
        createdAt: '2026-07-03T00:00:00Z',
      });
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([canonical, duplicate, deactivatedOther], true));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation completed-intent cleanup: duplicate match for COMPLETED intent ' +
          `intentId=500 bankId=${bankId} candidateCount=2`,
      );
      expect(loggerError.mock.calls.flat().join(' ')).not.toMatch(/LI\d{2}/);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        duplicate,
        referenceAccountIban,
        completedRef,
      );
    });

    it('skips protected duplicates without deactivating them', async () => {
      mockIntentFinds([], [completedIntent()]);
      const canonical = listingEntry(completedRef, { vban: canonicalVban });
      const protectedDuplicate = listingEntry(completedRef, {
        vban: duplicateVban,
        createdAt: '2026-07-02T00:00:00Z',
      });
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([canonical, protectedDuplicate], true));
      virtualIbanService.isIbanProtectedFromReconciliationDeactivation.mockResolvedValue(true);
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('protected IBAN refused deactivation for intentId=500'),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('ERROR-logs and continues when duplicate deactivation fails', async () => {
      mockIntentFinds([], [completedIntent()]);
      const canonical = listingEntry(completedRef, { vban: canonicalVban });
      const duplicate = listingEntry(completedRef, {
        vban: duplicateVban,
        createdAt: '2026-07-02T00:00:00Z',
      });
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([canonical, duplicate], true));
      jest.spyOn(frickVibanProvider, 'deactivateAndApprove').mockRejectedValue(new Error('deactivation ambiguous'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('duplicate cleanup failed for intentId=500'),
        expect.any(Error),
      );
    });

    it('refuses deactivation when the listing is not fully validated', async () => {
      mockIntentFinds([], [completedIntent()]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult(
            [listingEntry(completedRef, { vban: canonicalVban }), listingEntry(completedRef, { vban: duplicateVban })],
            false,
          ),
        );
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining(`listing for bankId=${bankId} not fully validated — no deactivation this run`),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('skips the bank when listing timestamps are invalid', async () => {
      mockIntentFinds([], [completedIntent()]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult(
          [listingEntry(completedRef, { vban: canonicalVban }), listingEntry(completedRef, { vban: duplicateVban })],
          true,
        ),
        listingStartedAt: new Date('invalid'),
      });
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining(`processing failed for bankId=${bankId}`),
        expect.any(Error),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('skips the bank when the listing fetch throws', async () => {
      mockIntentFinds([], [completedIntent()]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockRejectedValue(new Error('upstream listing unavailable'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining(`processing failed for bankId=${bankId}`),
        expect.any(Error),
      );
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('logs an outer completed-intent cleanup failure when the COMPLETED query itself throws', async () => {
      intentRepo.find.mockImplementation(async (options?: { where?: FindOptionsWhere<VirtualIbanIssuanceIntent> }) => {
        if (options?.where?.status === VirtualIbanIssuanceIntentStatus.COMPLETED) {
          throw new Error('completed intent repository unavailable');
        }
        return [];
      });
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation completed-intent cleanup failed:',
        expect.any(Error),
      );
      // Phase 2 still runs after the outer catch.
      expect(eventRepo.find).toHaveBeenCalled();
    });

    it('deactivates a DEACTIVATION_REQUESTED non-canonical duplicate', async () => {
      mockIntentFinds([], [completedIntent()]);
      const canonical = listingEntry(completedRef, { vban: canonicalVban });
      const deactivationRequested = listingEntry(completedRef, {
        vban: duplicateVban,
        state: FrickVirtualIbanState.DEACTIVATION_REQUESTED,
        createdAt: '2026-07-02T00:00:00Z',
      });
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([canonical, deactivationRequested], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        deactivationRequested,
        referenceAccountIban,
        completedRef,
      );
    });

    it('leaves a COMPLETED intent with only the canonical listing entry untouched', async () => {
      mockIntentFinds([], [completedIntent()]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(completedRef, { vban: canonicalVban })], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });
  });

  describe('Phase 2 — retired references', () => {
    it('sends no alert when no abandoned references are found', async () => {
      eventRepo.find.mockResolvedValue([]);

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('sends no alert when abandoned references exist but none match the fully-validated Frick listing', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).toHaveBeenCalledWith(referenceAccountIban);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('automatically deactivates an abandoned reference found in the Frick listing', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          id: 11,
          intentId: 21,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
        event({
          id: 12,
          intentId: 22,
          userDataId: 31,
          nextError: `recovery listing found no match under requestReference=${abandonedRecovery}; resetting to Pending with requestReference=dfx-viban-new`,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(
        listingResult(
          [
            listingEntry(abandonedCreate),
            listingEntry('dfx-viban-other', {
              vban: 'LI11ACTIVE00000000002',
              state: FrickVirtualIbanState.PREPARED,
              createdAt: '2026-07-02T00:00:00Z',
            }),
          ],
          true,
        ),
      );

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        expect.objectContaining({ description: abandonedCreate }),
        referenceAccountIban,
        abandonedCreate,
      );
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('ignores malformed Phase 2 descriptions and cleans up the valid orphan', async () => {
      eventRepo.find.mockResolvedValue([
        event({ id: 14, nextError: `${CREATE_PATH_REFERENCE_MARKER}${abandonedCreate}` }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult(
            [
              listingEntry(abandonedCreate, { vban: 'LI11MALFORMED00000002', description: undefined }),
              listingEntry(abandonedCreate),
            ],
            true,
          ),
        );

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
    });

    it('de-duplicates the same orphan vIBAN before cleanup', async () => {
      eventRepo.find.mockResolvedValue([
        event({ id: 15, nextError: `${CREATE_PATH_REFERENCE_MARKER}${abandonedCreate}` }),
      ]);
      const duplicate = listingEntry(abandonedCreate);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([duplicate, { ...duplicate }], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
    });

    it('logs ERROR and continues when automatic orphan cleanup fails', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          id: 13,
          nextError: `${CREATE_PATH_REFERENCE_MARKER}${abandonedCreate}`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedCreate)], true));
      jest.spyOn(frickVibanProvider, 'deactivateAndApprove').mockRejectedValue(new Error('deactivation ambiguous'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 2: automatic orphan cleanup failed for eventId=13',
        expect.any(Error),
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('skips deactivation when the matched orphan IBAN is protected locally', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          id: 16,
          intentId: 26,
          nextError: `${CREATE_PATH_REFERENCE_MARKER}${abandonedCreate}`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedCreate)], true));
      virtualIbanService.isIbanProtectedFromReconciliationDeactivation.mockResolvedValue(true);
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await service.reconcileRetiredIssuanceReferences();

      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('Frick vIBAN reconciliation Phase 2: retired-reference match eventId=16 intentId=26'),
      );
      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 2: protected IBAN refused deactivation for ' +
          `eventId=16 intentId=26 bankId=${bankId}`,
      );
      expect(loggerError.mock.calls.flat().join(' ')).not.toMatch(/LI\d{2}/);
      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not treat unmatched abandoned refs as clean when listing is not fully validated', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('still deactivates a positive orphan match when listing is incomplete', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedCreate)], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('does not call Bank Frick again for an orphan that is already deactivated', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `${CREATE_PATH_REFERENCE_MARKER}${abandonedCreate}`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult([listingEntry(abandonedCreate, { state: FrickVirtualIbanState.DEACTIVATED })], true),
        );

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).not.toHaveBeenCalled();
    });

    it('logs when the Frick listing fetch throws and does not rethrow', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockRejectedValue(new Error('upstream listing unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('continues Phase 2 cleanup for healthy banks when one bank throws', async () => {
      const healthyBankId = 52;
      const healthyReferenceAccountIban = 'LI00HEALTHY00000000000C';
      eventRepo.find.mockResolvedValue([
        event({
          id: 21,
          bankId,
          referenceAccountReceive: false,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
        event({
          id: 22,
          bankId: healthyBankId,
          referenceAccountIban: healthyReferenceAccountIban,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedRecovery}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedRecovery)], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        expect.objectContaining({ description: abandonedRecovery }),
        healthyReferenceAccountIban,
        abandonedRecovery,
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('queries abandoned references without a rolling time window', async () => {
      eventRepo.find.mockResolvedValue([]);

      await service.reconcileRetiredIssuanceReferences();

      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            expect.objectContaining({
              nextError: expect.anything(),
            }),
            expect.objectContaining({
              nextError: expect.anything(),
            }),
          ],
        }),
      );
      const findArg = eventRepo.find.mock.calls[0][0];
      // Marker presence alone — no nextStatus gate (merge-supersede is nextStatus=Failed).
      expect(findArg.where[0]).not.toHaveProperty('nextStatus');
      expect(findArg.where[1]).not.toHaveProperty('nextStatus');
      // No created: MoreThan(...) time filter — structural markers only.
      expect(findArg.where[0]).not.toHaveProperty('created');
      expect(findArg.where[1]).not.toHaveProperty('created');
    });

    it('filters historical Yapeal retirement events before any Bank Frick lookup or provider call', async () => {
      const yapealEvent = event({
        intentId: 777,
        bankId: 88,
        provider: IbanBankName.YAPEAL,
        nextError: `${CREATE_PATH_REFERENCE_MARKER}dfx-yapeal-retired-reference`,
      });
      eventRepo.find.mockImplementation(async (options?: { where?: FindOptionsWhere<VirtualIbanIssuanceEvent>[] }) => {
        const clauses = options?.where ?? [];
        const hasFrickProviderFilter = clauses.some((clause) => clause.provider === IbanBankName.FRICK);
        return hasFrickProviderFilter ? [] : [yapealEvent];
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([expect.objectContaining({ provider: IbanBankName.FRICK })]),
        }),
      );
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
    });

    it('finds merge-superseded FAILED events via the real where-clause path (not only extractAbandonedReference)', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const phase1ReopenReference = abandonedCreate;
      const unrelatedReference = 'dfx-viban-unrelatedneverretired0000001';

      const mergeSupersededEvent = event({
        id: 31,
        intentId: 41,
        nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        nextError:
          `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
          `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
      });
      const phase1ReopenEvent = event({
        id: 32,
        intentId: 42,
        nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
        nextError:
          `reconciliation: empty listing after safety threshold; ` +
          `${CREATE_PATH_REFERENCE_MARKER}${phase1ReopenReference}; newRequestReference=dfx-viban-new`,
      });
      const unrelatedEvent = event({
        id: 33,
        intentId: 43,
        nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        nextError: `create failed for an unrelated reason; requestReference=${unrelatedReference}`,
      });

      const candidatePool = [mergeSupersededEvent, phase1ReopenEvent, unrelatedEvent];

      /**
       * Interprets the TypeORM FindOptionsWhere[] the production code builds (array = OR of
       * clauses; each field is exact equality or a Like FindOperator). Bare mockResolvedValue
       * would ignore `where` and pass even against the old buggy nextStatus=Pending gate.
       */
      function matchesLikePattern(fieldValue: unknown, likePattern: string): boolean {
        if (fieldValue == null) return false;
        const escaped = likePattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        return new RegExp(`^${escaped}$`, 's').test(String(fieldValue));
      }

      function clauseMatchesEntity(
        entity: VirtualIbanIssuanceEvent,
        clause: FindOptionsWhere<VirtualIbanIssuanceEvent>,
      ): boolean {
        for (const [key, condition] of Object.entries(clause)) {
          const fieldValue = (entity as unknown as Record<string, unknown>)[key];
          if (condition instanceof FindOperator) {
            if (condition.type === 'like') {
              if (!matchesLikePattern(fieldValue, String(condition.value))) return false;
            } else {
              throw new Error(`Unexpected FindOperator type in where matcher: ${condition.type}`);
            }
          } else if (fieldValue !== condition) {
            return false;
          }
        }
        return true;
      }

      function entityMatchesWhere(
        entity: VirtualIbanIssuanceEvent,
        where: FindOptionsWhere<VirtualIbanIssuanceEvent> | FindOptionsWhere<VirtualIbanIssuanceEvent>[],
      ): boolean {
        const clauses = Array.isArray(where) ? where : [where];
        return clauses.some((clause) => clauseMatchesEntity(entity, clause));
      }

      eventRepo.find.mockImplementation(async (options?: { where?: unknown }) => {
        const where = options?.where as
          | FindOptionsWhere<VirtualIbanIssuanceEvent>
          | FindOptionsWhere<VirtualIbanIssuanceEvent>[]
          | undefined;
        if (where == null) return candidatePool;
        return candidatePool.filter((candidate) => entityMatchesWhere(candidate, where));
      });

      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult(
            [
              listingEntry(mergeRetiredReference),
              { ...listingEntry(phase1ReopenReference), vban: 'LI11ACTIVE00000000002' },
            ],
            true,
          ),
        );

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledTimes(2);
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        expect.objectContaining({ description: mergeRetiredReference }),
        referenceAccountIban,
        mergeRetiredReference,
      );
      expect(frickVibanProvider.deactivateAndApprove).toHaveBeenCalledWith(
        expect.objectContaining({ description: phase1ReopenReference }),
        referenceAccountIban,
        phase1ReopenReference,
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('edge cases for full coverage', () => {
    it('logs and continues when Phase 2 event nextError has a marker but empty reference value', async () => {
      // Productive-path reachable fixture: nextError contains CREATE_PATH_REFERENCE_MARKER so the
      // real WHERE nextError LIKE '%previousRequestReference=%' clause would return this row, but
      // the value after the marker is empty (marker immediately followed by ';') so extractAbandonedReference
      // cannot parse a reference → reason=reference_unextractable.
      const unextractableNextError = `${CREATE_PATH_REFERENCE_MARKER};newRequestReference=dfx-viban-irrelevant`;
      eventRepo.find.mockResolvedValue([
        event({
          id: 99,
          nextError: unextractableNextError,
        }),
      ]);

      await service.reconcileRetiredIssuanceReferences();

      // Zero resolvable abandoned references → Phase 2 must never reach Frick listing.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('logs a bank with no IBAN configured and does not abort the whole run', async () => {
      intentRepo.find.mockResolvedValue([
        intent({ id: 200, requestReference: stuckRequestReference, referenceAccountIban: '' }),
      ]);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('logs an outer Phase 1 failure when the intent query itself throws', async () => {
      intentRepo.find.mockRejectedValue(new Error('intent repository unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('still runs Phase 2 after a Phase 1 failure', async () => {
      intentRepo.find.mockRejectedValue(new Error('intent repository unavailable'));
      const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(eventRepo.find).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        'Frick vIBAN reconciliation Phase 1 (stuck intents) failed:',
        expect.any(Error),
      );
    });

    it('logs an outer Phase 2 failure when the abandoned-event query itself throws', async () => {
      eventRepo.find.mockRejectedValue(new Error('event repository unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('logs an outer Phase 2 failure when a LIKE-matched event has nextError=null', async () => {
      // Productively unreachable via the Postgres LIKE query path (NULL LIKE pattern is never
      // true — see the invariant comment in loadAbandonedReferences ~line 422). This test only
      // covers the fail-closed reaction to a hypothetical future dialect/driver violation of that
      // SQL invariant: coverage completeness + the throw path itself. The mock bypasses SQL
      // filtering and injects a row that production Postgres cannot return from that query.
      const invariantBreakingEvent = Object.assign(event({ id: 426, nextError: 'not-used' }), {
        nextError: null,
      });
      eventRepo.find.mockResolvedValue([invariantBreakingEvent]);

      // Outer try/catch in reconcileRetiredIssuanceReferences absorbs the throw — must not rethrow.
      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      // Fail-closed throw aborts loadAbandonedReferences before any Frick listing work.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('reuses the Phase-1 listing cache in Phase 2 for the same reference-account snapshot', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 202, requestReference: stuckRequestReference })]);
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).toHaveBeenCalledTimes(1);
    });

    it('extracts marker value when there is no trailing semicolon', () => {
      expect(service.extractAbandonedReference(`previousRequestReference=${abandonedCreate}`)).toBe(abandonedCreate);
      expect(
        service.extractAbandonedReference(
          `recovery listing found no match under requestReference=${abandonedRecovery}`,
        ),
      ).toBe(abandonedRecovery);
    });

    it('returns undefined when marker values are empty', () => {
      expect(service.extractAbandonedReference('previousRequestReference=; trailing')).toBeUndefined();
      expect(
        service.extractAbandonedReference('recovery listing found no match under requestReference=; trailing'),
      ).toBeUndefined();
      expect(service.extractAbandonedReference('no markers here')).toBeUndefined();
    });

    it('extracts requestReference from a merge-supersede nextError message shape', () => {
      // Shape produced by resolveIssuanceIntentsForMergeLocked / failFrickIntentLocked —
      // parser coverage only; the where-clause path is covered by the Phase-2 query-level test.
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const nextError =
        `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`;

      expect(service.extractAbandonedReference(nextError)).toBe(mergeRetiredReference);
    });
  });
});
