import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, ConfigService } from 'src/config/config';
import { LetterService } from 'src/integration/letter/letter.service';
import { LetterColor, LetterMode, LetterShip } from 'src/subdomains/generic/admin/dto/send-letter.dto';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull } from 'typeorm';
import { AddressLetterJobService } from '../address-letter-job.service';
import { AddressLetterOverflowError, AddressLetterPdfService } from '../address-letter-pdf.service';
import { AccountType } from '../account-type.enum';
import { KycLevel, KycType, UserDataStatus } from '../user-data.enum';
import { UserDataRepository } from '../user-data.repository';

// Constructed at module scope, not in `beforeAll`: the `it.each` table below reads Config while the
// test file is being loaded, which happens before any hook runs.
new ConfigService();

describe('AddressLetterJobService', () => {
  let service: AddressLetterJobService;

  let userDataRepo: UserDataRepository;
  let addressLetterPdfService: AddressLetterPdfService;
  let letterService: LetterService;
  let kycDocumentService: KycDocumentService;
  let kycFileService: KycFileService;
  let kycLogService: KycLogService;
  let notificationService: NotificationService;

  let queryBuilder: any;
  // Releases and the proof stamp run inside a transaction, so they go through the manager's repository
  // rather than through the injected one. This captures them.
  let txUpdate: jest.Mock;

  // synthetic test data only (public repo) — never a real customer name, address or account id
  function createUserData(id: number, overrides: Partial<any> = {}): any {
    return {
      id,
      kycLevel: KycLevel.LEVEL_50,
      kycType: KycType.DFX,
      status: UserDataStatus.ACTIVE,
      accountType: null,
      letterSentDate: null,
      firstname: 'Testina',
      surname: 'Musterfrau',
      naturalPersonName: 'Testina Musterfrau',
      street: 'Teststrasse',
      houseNumber: '42',
      zip: '9999',
      location: 'Musterstadt',
      country: { id: 1, symbol: 'CH', name: 'Schweiz' },
      letterFailures: 0,
      ...overrides,
    };
  }

  function createQueryBuilder(candidates: any[]): any {
    const qb: any = { calls: [] as { method: string; args: any[] }[] };
    for (const method of ['innerJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take']) {
      qb[method] = jest.fn((...args: any[]) => {
        qb.calls.push({ method, args });
        return qb;
      });
    }
    qb.getMany = jest.fn().mockResolvedValue(candidates);
    return qb;
  }

  function conditions(): string[] {
    return queryBuilder.calls.filter((c) => c.method === 'where' || c.method === 'andWhere').map((c) => c.args[0]);
  }

  /** The candidates a run works on, and the row each one is re-read as under its claim. */
  function withCandidates(...candidates: any[]): void {
    queryBuilder.getMany.mockResolvedValue(candidates);
    jest
      .spyOn(userDataRepo, 'findOneBy')
      .mockImplementation((where: any) => Promise.resolve(candidates.find((c) => c.id === where.id)));
  }

  beforeEach(async () => {
    userDataRepo = createMock<UserDataRepository>();
    addressLetterPdfService = createMock<AddressLetterPdfService>();
    letterService = createMock<LetterService>();
    kycDocumentService = createMock<KycDocumentService>();
    kycFileService = createMock<KycFileService>();
    kycLogService = createMock<KycLogService>();
    notificationService = createMock<NotificationService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressLetterJobService,
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: AddressLetterPdfService, useValue: addressLetterPdfService },
        { provide: LetterService, useValue: letterService },
        { provide: KycDocumentService, useValue: kycDocumentService },
        { provide: KycFileService, useValue: kycFileService },
        { provide: KycLogService, useValue: kycLogService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<AddressLetterJobService>(AddressLetterJobService);

    queryBuilder = createQueryBuilder([]);
    txUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    Object.defineProperty(userDataRepo, 'manager', {
      value: { transaction: (fn: any) => fn({ getRepository: () => ({ update: txUpdate }) }) },
      configurable: true,
    });
    jest.spyOn(userDataRepo, 'createQueryBuilder').mockReturnValue(queryBuilder);
    jest.spyOn(userDataRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(userDataRepo, 'findOneBy').mockResolvedValue(null);
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockResolvedValue({ base64: 'cGRm', pageCount: 1 });
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockResolvedValue({ file: { id: 1 } as any, url: 'url' });
    jest.spyOn(kycFileService, 'getUserDataKycFiles').mockResolvedValue([]);
    jest.spyOn(kycLogService, 'createAddressLetterLog').mockResolvedValue(undefined);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(true);
    Object.defineProperty(letterService, 'isConfigured', { get: () => true, configurable: true });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does nothing at all while the dispatch provider is unconfigured', async () => {
    Object.defineProperty(letterService, 'isConfigured', { get: () => false, configurable: true });

    await service.sendAddressLetters();

    expect(userDataRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(letterService.sendLetter).not.toHaveBeenCalled();
  });

  it('selects candidates by the inherited where clause, plus claim, retries and a printable address', async () => {
    await service.sendAddressLetters();

    const where = conditions();
    expect(where).toContain('userData.letterSentDate IS NULL');
    expect(where).toContain('userData.kycLevel >= :kycLevel');
    expect(where).toContain('userData.kycType = :kycType');
    expect(where).toContain('userData.status != :merged');
    expect(where).toContain('(userData.accountType IS NULL OR userData.accountType != :organization)');
    expect(where).toContain('userData.letterClaimDate IS NULL');
    expect(where).toContain('userData.letterFailures < :maxFailures');
    expect(queryBuilder.take).toHaveBeenCalledWith(Config.letter.addressLetter.batchSize);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('userData.id', 'ASC');
  });

  it('rejects blank name and address parts, not only NULL ones', async () => {
    await service.sendAddressLetters();

    // a blank string passes IS NOT NULL, prints an undeliverable envelope and would still be stamped
    for (const column of ['userData.firstname', 'userData.street', 'userData.zip', 'userData.location', 'country.name'])
      expect(conditions()).toContain(`NULLIF(BTRIM(${column}), '') IS NOT NULL`);
  });

  it('claims the account before it renders or sends anything', async () => {
    withCandidates(createUserData(7));

    await service.sendAddressLetters();

    const [criteria, values] = txUpdate.mock.calls[0];
    expect(criteria).toEqual({ id: 7, letterSentDate: IsNull(), letterClaimDate: IsNull() });
    expect(values).toEqual({ letterClaimDate: expect.any(Date) });

    // the attempt is on the record before anything else happens, so an unanswered dispatch is not
    // represented by a mutable column alone
    expect((kycLogService.createAddressLetterLog as jest.Mock).mock.calls[0][1]).toContain('claimed');

    // order, not just presence: rendering or sending before the claim would allow a double dispatch
    const claimOrder = txUpdate.mock.invocationCallOrder[0];
    const renderOrder = (addressLetterPdfService.generatePdf as jest.Mock).mock.invocationCallOrder[0];
    const sendOrder = (letterService.sendLetter as jest.Mock).mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(renderOrder);
    expect(renderOrder).toBeLessThan(sendOrder);
  });

  it('skips the account entirely when another replica won the claim', async () => {
    withCandidates(createUserData(7));
    txUpdate.mockResolvedValue({ affected: 0 });

    await service.sendAddressLetters();

    expect(addressLetterPdfService.generatePdf).not.toHaveBeenCalled();
    expect(letterService.sendLetter).not.toHaveBeenCalled();
  });

  it('renders from the row re-read under the claim, not from the selected one', async () => {
    const selected = createUserData(7, { street: 'Alte Strasse' });
    queryBuilder.getMany.mockResolvedValue([selected]);
    jest.spyOn(userDataRepo, 'findOneBy').mockResolvedValue(createUserData(7, { street: 'Neue Strasse' }) as any);

    await service.sendAddressLetters();

    expect((addressLetterPdfService.generatePdf as jest.Mock).mock.calls[0][0].street).toBe('Neue Strasse');
  });

  it('releases the claim without counting a failure when the address stopped being printable', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(userDataRepo, 'findOneBy').mockResolvedValue(createUserData(7, { street: '   ' }) as any);

    await service.sendAddressLetters();

    expect(letterService.sendLetter).not.toHaveBeenCalled();
    expect(txUpdate.mock.calls[1][1]).toEqual({ letterClaimDate: null });
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['merged', { status: UserDataStatus.MERGED }],
    ['an organization', { accountType: AccountType.ORGANIZATION }],
    ['below the KYC level', { kycLevel: KycLevel.LEVEL_40 }],
    ['a different KYC type', { kycType: KycType.LOCK }],
    ['already stamped', { letterSentDate: new Date() }],
    ['out of retries', { letterFailures: Config.letter.addressLetter.maxFailures }],
  ])('never sends to an account that became %s after it was selected', async (_case, change) => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(userDataRepo, 'findOneBy').mockResolvedValue(createUserData(7, change) as any);

    await service.sendAddressLetters();

    // the claim cannot carry these conditions, so they are re-checked on the claimed row
    expect(letterService.sendLetter).not.toHaveBeenCalled();
    expect(txUpdate.mock.calls[1][1]).toEqual({ letterClaimDate: null });
  });

  it('sends, stamps the AML proof and attaches the document, in that order', async () => {
    withCandidates(createUserData(7));

    await service.sendAddressLetters();

    expect(letterService.sendLetter).toHaveBeenCalledWith({
      data: 'cGRm',
      page: 1,
      color: LetterColor.COLOR,
      mode: LetterMode.SIMPLEX,
      ship: LetterShip.INTERNATIONAL,
    });

    const [criteria, values] = txUpdate.mock.calls[1];
    expect(criteria).toEqual({ id: 7, letterSentDate: IsNull(), letterClaimDate: expect.any(Date) });
    expect(values).toEqual({ letterSentDate: expect.any(Date) });

    const upload = (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0];
    expect(upload[1]).toBe(FileType.USER_NOTES);
    expect(upload[4]).toBe(ContentType.PDF);
    expect(upload[7]).toBe(FileSubType.POST_DISPATCH);

    // the proof may only be written after the dispatch, and the upload only after the proof
    const sendOrder = (letterService.sendLetter as jest.Mock).mock.invocationCallOrder[0];
    const stampOrder = txUpdate.mock.invocationCallOrder[1];
    const uploadOrder = (kycDocumentService.uploadUserFile as jest.Mock).mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(stampOrder);
    expect(stampOrder).toBeLessThan(uploadOrder);
  });

  it('names the file so the residence-address compliance report keeps finding it', async () => {
    withCandidates(createUserData(7));

    await service.sendAddressLetters();

    // Config.kyc.fileDownloadConfig id 10 filters with `file.name.includes('postversand')`, case-sensitively
    const name = (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0][2];
    expect(name).toContain('postversand');
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('reads the national country list case- and whitespace-insensitively', async () => {
    const original = process.env.LETTER_NATIONAL_COUNTRIES;
    process.env.LETTER_NATIONAL_COUNTRIES = ' de , ch ';
    new ConfigService();

    try {
      withCandidates(createUserData(7, { country: { id: 2, symbol: 'DE', name: 'Deutschland' } }));

      await service.sendAddressLetters();

      // the list is compared against an upper-cased symbol, so `de` must not route as international
      expect((letterService.sendLetter as jest.Mock).mock.calls[0][0].ship).toBe(LetterShip.NATIONAL);
    } finally {
      // assigning `undefined` would store the string "undefined" and leak into every later test
      if (original == null) delete process.env.LETTER_NATIONAL_COUNTRIES;
      else process.env.LETTER_NATIONAL_COUNTRIES = original;
      new ConfigService();
    }
  });

  it('ships nationally only for the countries the provider bills as national', async () => {
    withCandidates(createUserData(7, { country: { id: 2, symbol: 'de', name: 'Deutschland' } }));

    await service.sendAddressLetters();

    expect((letterService.sendLetter as jest.Mock).mock.calls[0][0].ship).toBe(LetterShip.NATIONAL);
  });

  it('never writes the AML proof when the provider rejected the job', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(txUpdate.mock.calls.some(([, values]) => 'letterSentDate' in values)).toBe(false);
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('records the transition before it clears the claim and counts the attempt', async () => {
    withCandidates(createUserData(7, { letterFailures: 1 }));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    const [criteria, values] = txUpdate.mock.calls[1];
    // guarded by the observed count AND by this attempt's own claim, so neither an overlapping run nor
    // a resumed stale attempt can clear a claim that is no longer theirs
    expect(criteria).toEqual({
      id: 7,
      letterSentDate: IsNull(),
      letterClaimDate: expect.any(Date),
      letterFailures: 1,
    });
    expect(values).toEqual({ letterClaimDate: null, letterFailures: 2 });

    const log = (kycLogService.createAddressLetterLog as jest.Mock).mock.calls[1];
    expect(log[1]).toContain('failures 1 -> 2');
    // event before snapshot, and in the same transaction: the log is passed the manager
    const logOrder = (kycLogService.createAddressLetterLog as jest.Mock).mock.invocationCallOrder[1];
    expect(logOrder).toBeLessThan(txUpdate.mock.invocationCallOrder[1]);
    expect(log[3]).toBeDefined();
  });

  it('changes nothing and reports no exhaustion when the claim was lost meanwhile', async () => {
    withCandidates(createUserData(7, { letterFailures: Config.letter.addressLetter.maxFailures - 1 }));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);
    // the claim itself succeeds; only the release finds the row already taken by someone else
    txUpdate.mockResolvedValueOnce({ affected: 1 }).mockResolvedValue({ affected: 0 });

    await service.sendAddressLetters();

    // an update that hit no row means someone else owns the claim - reporting exhaustion would name an
    // account whose counter this run does not control
    const mail = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
    expect(mail.input.errors.join(' ')).not.toContain('Retries exhausted');
    expect(mail.input.errors.join(' ')).toContain('unknown');
  });

  it('leaves the state untouched when the audit trail cannot be written', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);
    jest.spyOn(kycLogService, 'createAddressLetterLog').mockRejectedValue(new Error('audit store down'));

    await service.sendAddressLetters();

    // the claim transaction rolled back too, so not even the claim was written
    expect(txUpdate.mock.calls).toHaveLength(0);
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('keeps the claim when the dispatch went unanswered, so no second letter can follow', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(letterService, 'sendLetter').mockRejectedValue(new Error('gateway timeout'));

    await service.sendAddressLetters();

    expect(txUpdate.mock.calls).toHaveLength(1);
    expect(txUpdate.mock.calls[0][1]).toEqual({ letterClaimDate: expect.any(Date) });
    expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('stops the run at the first send failure instead of burning every retry budget', async () => {
    withCandidates(createUserData(7), createUserData(8));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(letterService.sendLetter).toHaveBeenCalledTimes(1);
  });

  it('carries on after an overflowing recipient block — that is this account, not the template', async () => {
    withCandidates(createUserData(7), createUserData(8));
    jest
      .spyOn(addressLetterPdfService, 'generatePdf')
      .mockRejectedValueOnce(new AddressLetterOverflowError('too long'))
      .mockResolvedValue({ base64: 'cGRm', pageCount: 1 });

    await service.sendAddressLetters();

    // account 7 is counted and skipped, account 8 still gets its letter
    expect(addressLetterPdfService.generatePdf).toHaveBeenCalledTimes(2);
    expect(letterService.sendLetter).toHaveBeenCalledTimes(1);
  });

  it('stops the run on a rendering failure too — the template is the same for everyone', async () => {
    withCandidates(createUserData(7), createUserData(8));
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockRejectedValue(new Error('render boom'));

    await service.sendAddressLetters();

    expect(addressLetterPdfService.generatePdf).toHaveBeenCalledTimes(1);
    expect(letterService.sendLetter).not.toHaveBeenCalled();
    expect(txUpdate.mock.calls[1][1]).toEqual({ letterClaimDate: null, letterFailures: 1 });
  });

  it('escalates once the retries of an account ran out', async () => {
    withCandidates(createUserData(7, { letterFailures: Config.letter.addressLetter.maxFailures - 1 }));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    const mail = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
    expect(mail.type).toBe(MailType.ERROR_MONITORING);
    expect(mail.input.subject).toContain('7');
    expect(mail.options).toEqual({ suppressRecurring: true });
    expect(mail.correlationId).toBe('AddressLetterDispatch&7');
    expect(mail.input.errors.join(' ')).toContain(`Retries exhausted (${Config.letter.addressLetter.maxFailures})`);
  });

  it('stays quiet while an account still has retries left', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('keeps the AML proof when only the document upload failed after dispatch', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockRejectedValue(new Error('storage down'));

    await service.sendAddressLetters();

    expect(txUpdate.mock.calls[1][1]).toEqual({ letterSentDate: expect.any(Date) });
    // an upload failure is not a dispatch failure: nothing is rolled back and no retry is queued
    expect(txUpdate.mock.calls).toHaveLength(2);
  });

  it('invalidates the row a failed upload left behind, so it cannot pass as a stored document', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockRejectedValue(new Error('storage down'));
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockImplementation(() =>
        Promise.resolve([{ id: 42, name: (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0][2] }] as any),
      );

    await service.sendAddressLetters();

    expect(kycFileService.invalidateKycFile).toHaveBeenCalledWith(42, expect.anything());
    // the cache may only be dropped once the row is committed, or a concurrent read refills it with
    // the still-valid row and that stale entry outlives the commit
    expect(kycFileService.invalidateKycFileCache).toHaveBeenCalled();
    expect((kycFileService.invalidateKycFile as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (kycFileService.invalidateKycFileCache as jest.Mock).mock.invocationCallOrder[0],
    );
    // `valid` is a snapshot column too: the transition is recorded, naming the file, before the update
    const log = (kycLogService.createAddressLetterLog as jest.Mock).mock.calls.find((c) =>
      c[1].includes('document invalidated'),
    );
    expect(log[1]).toContain('valid true -> false');
    expect(log[4]).toBe(42);
  });

  it('bills the pages it actually rendered', async () => {
    withCandidates(createUserData(7));
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockResolvedValue({ base64: 'cGRm', pageCount: 2 });

    await service.sendAddressLetters();

    expect((letterService.sendLetter as jest.Mock).mock.calls[0][0].page).toBe(2);
  });

  it('records the dispatch itself for the audit trail', async () => {
    withCandidates(createUserData(7));

    await service.sendAddressLetters();

    const [claimed, dispatched, document] = (kycLogService.createAddressLetterLog as jest.Mock).mock.calls;
    expect(claimed[1]).toContain('claimed');
    expect(dispatched[1]).toContain('dispatched');
    expect(document[1]).toContain('document stored: file 1');
  });
});
