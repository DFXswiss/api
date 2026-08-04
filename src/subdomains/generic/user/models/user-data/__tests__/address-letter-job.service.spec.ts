import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { LetterService } from 'src/integration/letter/letter.service';
import { LetterColor, LetterMode, LetterShip } from 'src/subdomains/generic/admin/dto/send-letter.dto';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull } from 'typeorm';
import { AddressLetterJobService, LETTER_BATCH_SIZE, MAX_LETTER_FAILURES } from '../address-letter-job.service';
import { AddressLetterPdfService } from '../address-letter-pdf.service';
import { UserDataRepository } from '../user-data.repository';

describe('AddressLetterJobService', () => {
  let service: AddressLetterJobService;

  let userDataRepo: UserDataRepository;
  let addressLetterPdfService: AddressLetterPdfService;
  let letterService: LetterService;
  let kycDocumentService: KycDocumentService;
  let notificationService: NotificationService;

  let queryBuilder: any;

  // synthetic test data only (public repo) — never a real customer name, address or account id
  function createUserData(id: number, overrides: Partial<any> = {}): any {
    return {
      id,
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

  function updateCalls(): any[][] {
    return (userDataRepo.update as jest.Mock).mock.calls;
  }

  beforeEach(async () => {
    userDataRepo = createMock<UserDataRepository>();
    addressLetterPdfService = createMock<AddressLetterPdfService>();
    letterService = createMock<LetterService>();
    kycDocumentService = createMock<KycDocumentService>();
    notificationService = createMock<NotificationService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressLetterJobService,
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: AddressLetterPdfService, useValue: addressLetterPdfService },
        { provide: LetterService, useValue: letterService },
        { provide: KycDocumentService, useValue: kycDocumentService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<AddressLetterJobService>(AddressLetterJobService);

    queryBuilder = createQueryBuilder([]);
    jest.spyOn(userDataRepo, 'createQueryBuilder').mockReturnValue(queryBuilder);
    jest.spyOn(userDataRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockResolvedValue({ base64: 'cGRm', pageCount: 1 });
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockResolvedValue({ file: { id: 1 } as any, url: 'url' });
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
    expect(where).toContain('userData.firstname IS NOT NULL');
    expect(where).toContain('userData.letterClaimDate IS NULL');
    expect(where).toContain('userData.letterFailures < :maxFailures');
    expect(where).toContain('userData.street IS NOT NULL');
    expect(where).toContain('userData.zip IS NOT NULL');
    expect(where).toContain('userData.location IS NOT NULL');
    expect(where).toContain('country.id IS NOT NULL');
    expect(queryBuilder.take).toHaveBeenCalledWith(LETTER_BATCH_SIZE);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('userData.id', 'ASC');
  });

  it('claims the account before it renders or sends anything', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);

    await service.sendAddressLetters();

    const [criteria, values] = updateCalls()[0];
    expect(criteria).toEqual({ id: 7, letterSentDate: IsNull(), letterClaimDate: IsNull() });
    expect(values).toEqual({ letterClaimDate: expect.any(Date) });
  });

  it('skips the account entirely when another replica won the claim', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(userDataRepo, 'update').mockResolvedValue({ affected: 0 } as any);

    await service.sendAddressLetters();

    expect(addressLetterPdfService.generatePdf).not.toHaveBeenCalled();
    expect(letterService.sendLetter).not.toHaveBeenCalled();
  });

  it('sends, stamps the AML proof and attaches the document, in that order', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);

    await service.sendAddressLetters();

    expect(letterService.sendLetter).toHaveBeenCalledWith({
      data: 'cGRm',
      page: 1,
      color: LetterColor.COLOR,
      mode: LetterMode.SIMPLEX,
      ship: LetterShip.INTERNATIONAL,
    });

    const [criteria, values] = updateCalls()[1];
    expect(criteria).toEqual({ id: 7, letterSentDate: IsNull() });
    expect(values).toEqual({ letterSentDate: expect.any(Date) });

    const upload = (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0];
    expect(upload[1]).toBe(FileType.USER_NOTES);
    expect(upload[4]).toBe(ContentType.PDF);
    expect(upload[7]).toBe(FileSubType.POST_DISPATCH);
  });

  it('names the file so the residence-address compliance report keeps finding it', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);

    await service.sendAddressLetters();

    // Config.kyc.fileDownloadConfig id 10 filters with `file.name.includes('postversand')`, case-sensitively
    const name = (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0][2];
    expect(name).toContain('postversand');
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('ships nationally only for the countries the provider bills as national', async () => {
    queryBuilder.getMany.mockResolvedValue([
      createUserData(7, { country: { id: 2, symbol: 'de', name: 'Deutschland' } }),
    ]);

    await service.sendAddressLetters();

    expect((letterService.sendLetter as jest.Mock).mock.calls[0][0].ship).toBe(LetterShip.NATIONAL);
  });

  it('never writes the AML proof when the provider rejected the job', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(updateCalls().some(([, values]) => 'letterSentDate' in values)).toBe(false);
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('releases the claim and counts the attempt when the provider rejected the job', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7, { letterFailures: 1 })]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    const [criteria, values] = updateCalls()[1];
    expect(criteria).toEqual({ id: 7 });
    expect(values).toEqual({ letterClaimDate: null, letterFailures: 2 });
  });

  it('keeps the claim when the dispatch went unanswered, so no second letter can follow', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(letterService, 'sendLetter').mockRejectedValue(new Error('gateway timeout'));

    await service.sendAddressLetters();

    // the claim is the only write; nothing releases it and nothing stamps a proof
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0][1]).toEqual({ letterClaimDate: expect.any(Date) });
    expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('stops the run at the first send failure instead of burning every retry budget', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7), createUserData(8)]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(letterService.sendLetter).toHaveBeenCalledTimes(1);
  });

  it('escalates once the retries of an account ran out', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7, { letterFailures: MAX_LETTER_FAILURES - 1 })]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    const mail = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
    expect(mail.type).toBe(MailType.ERROR_MONITORING);
    expect(mail.input.subject).toContain('7');
    expect(mail.options).toEqual({ suppressRecurring: true });
    expect(mail.correlationId).toBe('AddressLetterDispatch&7');
  });

  it('stays quiet while an account still has retries left', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('releases the claim and never sends when the letter cannot be rendered', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockRejectedValue(new Error('render boom'));

    await service.sendAddressLetters();

    expect(letterService.sendLetter).not.toHaveBeenCalled();
    expect(updateCalls()[1][1]).toEqual({ letterClaimDate: null, letterFailures: 1 });
  });

  it('keeps the AML proof when only the document upload failed after dispatch', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockRejectedValue(new Error('storage down'));

    await service.sendAddressLetters();

    expect(updateCalls()[1][1]).toEqual({ letterSentDate: expect.any(Date) });
    // an upload failure is not a dispatch failure: nothing is rolled back and no retry is queued
    expect(updateCalls()).toHaveLength(2);
  });

  it('bills the pages it actually rendered', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(7)]);
    jest.spyOn(addressLetterPdfService, 'generatePdf').mockResolvedValue({ base64: 'cGRm', pageCount: 2 });

    await service.sendAddressLetters();

    expect((letterService.sendLetter as jest.Mock).mock.calls[0][0].page).toBe(2);
  });

  it('sends one aggregated alert for the accounts a run left behind', async () => {
    queryBuilder.getMany.mockResolvedValue([createUserData(9, { letterFailures: MAX_LETTER_FAILURES - 1 })]);
    jest.spyOn(letterService, 'sendLetter').mockResolvedValue(false);

    await service.sendAddressLetters();

    expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
    const mail = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
    expect(mail.input.errors.join(' ')).toContain(`Retries exhausted (${MAX_LETTER_FAILURES})`);
  });
});
