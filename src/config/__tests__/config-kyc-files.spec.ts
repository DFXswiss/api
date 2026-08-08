import JSZip from 'jszip';
import { Configuration } from 'src/config/config';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycIdentificationType } from 'src/subdomains/generic/user/models/user-data/kyc-identification-type.enum';
import { LegalEntity } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

/**
 * The GwG compliance ZIP is assembled purely from the declarative `fileDownloadConfig`: each group
 * contributes its `ignore`, and each file entry its `prefixes` / `filter` / `name` / `sort` /
 * `handleFileNotFound`. Those closures are the whole selection logic — a wrong predicate silently
 * puts the wrong document (or no document) into a regulator-facing archive, with no error anywhere.
 * These tests exercise them directly, one behaviour per group.
 */
describe('fileDownloadConfig', () => {
  const config = new Configuration();

  const USER_ID = 42;

  function group(id: number) {
    const entry = config.fileDownloadConfig.find((c) => c.id === id);
    if (!entry) throw new Error(`no fileDownloadConfig entry with id ${id}`);
    return entry;
  }

  function filterOf(id: number, fileIndex = 0): (file: KycFileBlob, userData: UserData) => boolean {
    const filter = group(id).files[fileIndex].filter;
    if (!filter) throw new Error(`fileDownloadConfig ${id}/${fileIndex} has no filter`);
    return filter;
  }

  function nameOf(id: number, fileIndex = 0): (file: KycFileBlob) => string {
    const name = group(id).files[fileIndex].name;
    if (!name) throw new Error(`fileDownloadConfig ${id}/${fileIndex} has no name`);
    return name;
  }

  function blob(partial: Partial<KycFileBlob> = {}): KycFileBlob {
    return {
      name: `user/${USER_ID}/UserNotes/some-file.pdf`,
      url: `https://files.dfx.swiss/kyc/user/${USER_ID}/UserNotes/some-file.pdf`,
      contentType: ContentType.PDF,
      category: FileCategory.USER,
      ...partial,
    } as KycFileBlob;
  }

  function user(partial: Record<string, unknown> = {}): UserData {
    return { id: USER_ID, kycSteps: [], ...partial } as unknown as UserData;
  }

  function step(partial: Record<string, unknown>): KycStep {
    return { id: 1, isCompleted: true, ...partial } as unknown as KycStep;
  }

  it('numbers the groups gaplessly from 1, so the ZIP folder order is the audit order', () => {
    expect(config.fileDownloadConfig.map((c) => c.id)).toEqual(
      Array.from({ length: config.fileDownloadConfig.length }, (_, i) => i + 1),
    );
    expect(config.fileDownloadConfig.every((c) => c.name.length > 0)).toBe(true);
  });

  // A prefix is the storage path the ZIP builder lists. Any prefix not scoped to the requesting
  // user's own id would leak another customer's KYC documents into this customer's archive, which
  // is why this is asserted for every group and every file entry rather than spot-checked.
  it('scopes every prefix of every group to the requesting user own id', () => {
    // VIDEO_ID so group 3 (which switches on the identification type) also yields prefixes here.
    const userData = user({ identificationType: KycIdentificationType.VIDEO_ID });

    const prefixes = config.fileDownloadConfig.flatMap((c) => c.files.flatMap((f) => f.prefixes(userData)));

    expect(prefixes.length).toBeGreaterThan(0);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(new RegExp(`^(user|spider)/${USER_ID}/[\\w-]+$`));
    }
  });

  describe('id 1 - Deckblatt', () => {
    it('reads the cover sheet from the user notes', () => {
      expect(group(1).files[0].prefixes(user())).toEqual([`user/${USER_ID}/UserNotes`]);
    });

    it('selects only the GwG cover sheet', () => {
      const filter = filterOf(1);

      expect(filter(blob({ name: 'GwGFileDeckblatt_2026.pdf' }), user())).toBe(true);
      expect(filter(blob({ name: 'Kundenprofil.pdf' }), user())).toBe(false);
    });
  });

  describe('id 2 - Identifikationsdokument', () => {
    it('collects the ident PDF from the current and both legacy spider locations', () => {
      expect(group(2).files[0].prefixes(user())).toEqual([
        `user/${USER_ID}/Identification`,
        `spider/${USER_ID}/online-identification`,
        `spider/${USER_ID}/video_identification`,
      ]);
    });

    it('names an ident image after its bare file name', () => {
      expect(nameOf(2, 1)(blob({ name: `user/${USER_ID}/Identification/selfie.png` }))).toBe('selfie');
    });

    it('keeps only the images of the newest completed ident attempt', () => {
      const filter = filterOf(2, 1);
      const userData = user({
        kycSteps: [
          step({ id: 1, name: KycStepName.IDENT, transactionId: 'ident-old' }),
          step({ id: 2, name: KycStepName.IDENT, transactionId: 'ident-new' }),
        ],
      });

      expect(filter(blob({ name: 'ident-new-selfie.png' }), userData)).toBe(true);
      expect(filter(blob({ name: 'ident-old-selfie.png' }), userData)).toBe(false);
    });

    it('ignores ident steps that are unfinished or carry no transaction id', () => {
      const filter = filterOf(2, 1);

      const unfinished = user({
        kycSteps: [step({ name: KycStepName.IDENT, isCompleted: false, transactionId: 'ident-1' })],
      });
      const withoutTransaction = user({ kycSteps: [step({ name: KycStepName.IDENT })] });
      const otherStep = user({ kycSteps: [step({ name: KycStepName.NATIONALITY_DATA, transactionId: 'ident-1' })] });

      expect(filter(blob({ name: 'ident-1-selfie.png' }), unfinished)).toBe(false);
      expect(filter(blob({ name: 'ident-1-selfie.png' }), withoutTransaction)).toBe(false);
      expect(filter(blob({ name: 'ident-1-selfie.png' }), otherStep)).toBe(false);
    });

    // Ident images are optional (only some providers deliver them), so their absence must not abort
    // the ZIP - `true` tells the builder the missing file is already handled.
    it('treats missing ident images as handled instead of failing the ZIP', () => {
      expect(group(2).files[1].handleFileNotFound?.({} as JSZip, user())).toBe(true);
      expect(group(2).files[1].selectAll).toBe(true);
    });
  });

  describe('id 3 - Banktransaktion oder Videoident Tonspur', () => {
    it('names the file after what it actually is', () => {
      const name = nameOf(3);

      expect(name(blob({ name: 'bankTransactionVerify.pdf' }))).toBe('Banktransaktion');
      expect(name(blob({ name: 'recording.mp3' }))).toBe('VideoIdentTonspur');
    });

    it('picks the prefixes from the identification type', () => {
      const prefixes = group(3).files[0].prefixes;

      expect(prefixes(user({ identificationType: KycIdentificationType.VIDEO_ID }))).toEqual([
        `user/${USER_ID}/Identification`,
        `spider/${USER_ID}/video_identification`,
      ]);
      expect(prefixes(user({ identificationType: KycIdentificationType.ONLINE_ID }))).toEqual([
        `user/${USER_ID}/UserNotes`,
      ]);
      // MANUAL (and any unset type) has no source location — the group is covered by the
      // handleFileNotFound placeholder below instead.
      expect(prefixes(user({ identificationType: KycIdentificationType.MANUAL }))).toEqual([]);
    });

    it('takes the audio track for a video ident and the bank-transaction PDF for an online ident', () => {
      const filter = filterOf(3);
      const videoUser = user({ identificationType: KycIdentificationType.VIDEO_ID });
      const onlineUser = user({ identificationType: KycIdentificationType.ONLINE_ID });

      expect(filter(blob({ name: 'recording.mp3', contentType: ContentType.MP3 }), videoUser)).toBe(true);
      expect(filter(blob({ name: 'recording.mp4', contentType: ContentType.MP4 }), videoUser)).toBe(true);
      // A video ident contributes its recording only — its own PDF report belongs to other groups.
      expect(filter(blob({ name: 'report.pdf' }), videoUser)).toBe(false);

      expect(filter(blob({ name: 'bankTransactionVerify.pdf' }), onlineUser)).toBe(true);
      expect(filter(blob({ name: 'report.pdf' }), onlineUser)).toBe(false);
    });

    it('drops a placeholder note for a manual identification and fails over for every other type', () => {
      const handleFileNotFound = group(3).files[0].handleFileNotFound;
      const zip = { file: jest.fn() } as unknown as JSZip;

      handleFileNotFound?.(zip, user({ identificationType: KycIdentificationType.MANUAL }));

      expect(zip.file).toHaveBeenCalledWith('03_nicht_benötigt_aufgrund_manueller_identifikation.txt', '');

      // Any other type is expected to deliver the file, so a missing one is NOT handled here.
      expect(handleFileNotFound?.(zip, user({ identificationType: KycIdentificationType.VIDEO_ID }))).toBe(false);
    });
  });

  describe('ids 4, 5, 6, 9, 13, 14 - single-document user-note groups', () => {
    // Each of these groups is one PDF in the user notes, identified by a substring of its name.
    // Tabulated because the groups differ only in that substring; a group matching another
    // group's document would silently duplicate/misfile it in the archive.
    it.each([
      [4, 'Identifizierungsformular'],
      [5, 'Kundenprofil'],
      [6, 'Risikoprofil'],
      [9, 'blockchainAddressAnalyse'],
      [13, '-TxAudit2026'],
      [14, '-NameCheck'],
    ] as [number, string][])('group %i selects the %s document from the user notes', (id, marker) => {
      expect(group(id).files[0].prefixes(user())).toEqual([`user/${USER_ID}/UserNotes`]);
      expect(group(id).files[0].fileTypes).toEqual([ContentType.PDF]);

      const filter = filterOf(id);
      expect(filter(blob({ name: `2026-01-01_${marker}.pdf` }), user())).toBe(true);
      expect(filter(blob({ name: '2026-01-01_SomethingElse.pdf' }), user())).toBe(false);
    });

    it('matches the audit and name-check markers case-insensitively', () => {
      // Those two filters lower-case both sides, so a differently-cased upload still lands.
      expect(filterOf(13)(blob({ name: '2026-txaudit2026.pdf' }), user())).toBe(true);
      expect(filterOf(14)(blob({ name: '2026-namecheck.pdf' }), user())).toBe(true);
    });

    it('adds the Dilisense screening report as a second, separately named name-check file', () => {
      expect(group(14).files[1].prefixes(user())).toEqual([`user/${USER_ID}/NameCheck`]);
      expect(nameOf(14, 1)(blob())).toBe('Dilisense Screening Report');
    });
  });

  describe('id 7 - Formular A oder K', () => {
    it('names the file after the form it contains', () => {
      const name = nameOf(7);

      expect(name(blob({ name: 'FormularA.pdf' }))).toBe('FormularA');
      expect(name(blob({ name: 'FormularK.pdf' }))).toBe('FormularK');
    });

    // Formular A (beneficial owner) is for natural persons and Sitzgesellschaften, Formular K
    // (controlling person) for operating companies and associations. Attaching the wrong form is a
    // GwG documentation defect, so the account type decides which one is accepted.
    it('accepts Formular A only for natural persons / Sitzgesellschaften', () => {
      const filter = filterOf(7);
      const naturalPerson = user({ amlAccountType: 'natural person' });

      expect(filter(blob({ name: 'FormularA.pdf' }), naturalPerson)).toBe(true);
      expect(filter(blob({ name: 'FormularK.pdf' }), naturalPerson)).toBe(false);
      expect(filter(blob({ name: 'FormularA.pdf' }), user({ amlAccountType: 'Sitzgesellschaft' }))).toBe(true);
    });

    it('accepts Formular K only for operating companies / associations', () => {
      const filter = filterOf(7);

      expect(filter(blob({ name: 'FormularK.pdf' }), user({ amlAccountType: 'Verein' }))).toBe(true);
      expect(filter(blob({ name: 'FormularK.pdf' }), user({ amlAccountType: 'operativ tätige Gesellschaft' }))).toBe(
        true,
      );
      expect(filter(blob({ name: 'FormularA.pdf' }), user({ amlAccountType: 'Verein' }))).toBe(false);
    });
  });

  describe('id 8 - Onboardingdokument', () => {
    it('looks in the spider archive and the user notes, and matches case-insensitively', () => {
      expect(group(8).files[0].prefixes(user())).toEqual([
        `spider/${USER_ID}/user-added-document`,
        `user/${USER_ID}/UserNotes`,
      ]);
      expect(nameOf(8)(blob())).toBe('Onboarding');

      const filter = filterOf(8);
      expect(filter(blob({ name: 'PreOnboardingReport.pdf' }), user())).toBe(true);
      expect(filter(blob({ name: 'onboarding_2026.pdf' }), user())).toBe(true);
      expect(filter(blob({ name: 'Risikoprofil.pdf' }), user())).toBe(false);
    });
  });

  describe('id 10 - Überprüfung der Wohnsitzadresse', () => {
    // An organization has no residential address, so the group must not appear in its archive.
    it('applies to private customers only', () => {
      const ignore = group(10).ignore;

      expect(ignore?.(user({ accountType: AccountType.ORGANIZATION }))).toBe(true);
      expect(ignore?.(user({ accountType: AccountType.PERSONAL }))).toBe(false);
    });

    it('matches the DFX postversand file by marker and a legacy spider file by the customer first name', () => {
      const filter = filterOf(10);
      const userData = user({ firstname: 'Erika' });

      expect(nameOf(10)(blob())).toBe('Postversand');

      expect(filter(blob({ category: FileCategory.USER, name: 'postversand.pdf' }), userData)).toBe(true);
      expect(filter(blob({ category: FileCategory.USER, name: 'other.pdf' }), userData)).toBe(false);
      // Spider files carry no marker, only the customer name — compared lower-cased on both sides.
      expect(filter(blob({ category: FileCategory.SPIDER, name: 'ERIKA_Adresse.pdf' }), userData)).toBe(true);
      expect(filter(blob({ category: FileCategory.SPIDER, name: 'Hans_Adresse.pdf' }), userData)).toBe(false);
    });
  });

  describe('id 11 - Handelsregisterauszug', () => {
    it('applies to organizations only', () => {
      const ignore = group(11).ignore;

      expect(ignore?.(user({ accountType: AccountType.PERSONAL }))).toBe(true);
      expect(ignore?.(user({ accountType: AccountType.ORGANIZATION }))).toBe(false);
    });

    // The register extract can be attached by three different KYC steps; all three store the blob
    // URL of exactly the document that belongs into this group.
    it.each([
      [KycStepName.COMMERCIAL_REGISTER, (url: string) => step({ name: KycStepName.COMMERCIAL_REGISTER, result: url })],
      [
        KycStepName.LEGAL_ENTITY,
        (url: string) =>
          step({ name: KycStepName.LEGAL_ENTITY, getResult: () => ({ url, legalEntity: LegalEntity.AG }) }),
      ],
      [
        KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION,
        (url: string) => step({ name: KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION, getResult: () => ({ url }) }),
      ],
    ] as [KycStepName, (url: string) => KycStep][])(
      'selects the document referenced by a completed %s step',
      (_name, makeStep) => {
        const url = `https://files.dfx.swiss/kyc/user/${USER_ID}/CommercialRegister/hr.pdf`;
        const otherUrl = `https://files.dfx.swiss/kyc/user/${USER_ID}/CommercialRegister/other.pdf`;
        const filter = filterOf(11);

        expect(filter(blob({ url }), user({ kycSteps: [makeStep(url)] }))).toBe(true);
        expect(filter(blob({ url: otherUrl }), user({ kycSteps: [makeStep(url)] }))).toBe(false);
      },
    );

    it('ignores an unfinished step', () => {
      const url = `https://files.dfx.swiss/kyc/user/${USER_ID}/CommercialRegister/hr.pdf`;

      const userData = user({
        kycSteps: [step({ name: KycStepName.COMMERCIAL_REGISTER, isCompleted: false, result: url })],
      });

      expect(filterOf(11)(blob({ url }), userData)).toBe(false);
    });
  });

  describe('id 12 - Vollmacht', () => {
    // Only relevant when the account was opened on the strength of a power of attorney.
    it('applies only when the account opener acted under a Vollmacht', () => {
      const ignore = group(12).ignore;

      expect(ignore?.(user({ accountOpenerAuthorization: 'Vollmacht' }))).toBe(false);
      expect(ignore?.(user({ accountOpenerAuthorization: 'Verwaltungsrat' }))).toBe(true);
      expect(ignore?.(user())).toBe(true);
    });

    it('selects the document referenced by the completed authority step', () => {
      const url = `https://files.dfx.swiss/kyc/user/${USER_ID}/Authority/vollmacht.pdf`;
      const filter = filterOf(12);

      expect(group(12).files[0].prefixes(user())).toEqual([`user/${USER_ID}/Authority`]);
      expect(filter(blob({ url }), user({ kycSteps: [step({ name: KycStepName.AUTHORITY, result: url })] }))).toBe(
        true,
      );
      expect(
        filter(
          blob({ url }),
          user({ kycSteps: [step({ name: KycStepName.AUTHORITY, isCompleted: false, result: url })] }),
        ),
      ).toBe(false);
      expect(
        filter(blob({ url }), user({ kycSteps: [step({ name: KycStepName.NATIONALITY_DATA, result: url })] })),
      ).toBe(false);
    });
  });

  describe('id 15 - Travel Rule', () => {
    it('selects the address-signature files and keeps the earliest of two candidates', () => {
      const filter = filterOf(15);
      const sort = group(15).files[0].sort;

      expect(filter(blob({ name: '20260101-AddressSignature.pdf' }), user())).toBe(true);
      expect(filter(blob({ name: '20260101-Kundenprofil.pdf' }), user())).toBe(false);

      // `sort` is used as a reducer by the ZIP builder, so it returns the surviving candidate. It
      // compares the segment before the first dash and keeps the lower one — the FIRST signature,
      // unlike the default (newest `updated` wins) the builder applies without a sort.
      const first = blob({ name: '20260101-AddressSignature.pdf' });
      const later = blob({ name: '20260630-AddressSignature.pdf' });

      expect(sort?.(first, later)).toBe(first);
      expect(sort?.(later, first)).toBe(first);
    });
  });

  describe('id 16 - TMER', () => {
    it('collects every TMER report under its own bare file name', () => {
      const filter = filterOf(16);

      expect(filter(blob({ name: `user/${USER_ID}/UserNotes/2026-TMER-01.pdf` }), user())).toBe(true);
      expect(filter(blob({ name: `user/${USER_ID}/UserNotes/2026-NameCheck.pdf` }), user())).toBe(false);

      expect(nameOf(16)(blob({ name: `user/${USER_ID}/UserNotes/2026-TMER-01.pdf` }))).toBe('2026-TMER-01');
      expect(group(16).files[0].selectAll).toBe(true);
      // A customer without any TMER report is normal, so its absence must not abort the ZIP.
      expect(group(16).files[0].handleFileNotFound?.({} as JSZip, user())).toBe(true);
    });
  });
});

/**
 * Host-independent comparison of a stored KYC step result URL against a live blob URL, used by the
 * groups 11 and 12 filters above. After the Azure Blob -> MinIO cutover the two hosts differ, so a
 * full-URL comparison would silently drop every pre-cutover organization document from the
 * compliance ZIP.
 */
describe('Configuration.isSameKycBlob', () => {
  const key = 'user/42/CommercialRegister/hr-auszug.pdf';
  const azureUrl = `https://myaccount.blob.core.windows.net/kyc/${key}`;
  const minioUrl = `https://files.dfx.swiss/kyc/${key}`;

  it('compares the container-relative object key, not the host', () => {
    expect(azureUrl).not.toEqual(minioUrl);
    expect(Configuration.isSameKycBlob(azureUrl, minioUrl)).toBe(true);
  });

  it('decodes percent-escaped path segments before comparing', () => {
    expect(
      Configuration.isSameKycBlob(
        'https://myaccount.blob.core.windows.net/kyc/user/42/Authority/HR%20Vollmacht.pdf',
        'https://files.dfx.swiss/kyc/user/42/Authority/HR Vollmacht.pdf',
      ),
    ).toBe(true);
  });

  it('does not match different object keys', () => {
    expect(Configuration.isSameKycBlob(azureUrl, `https://files.dfx.swiss/kyc/user/42/CommercialRegister/x.pdf`)).toBe(
      false,
    );
  });

  it('fails closed on a missing value instead of throwing', () => {
    expect(Configuration.isSameKycBlob(undefined, minioUrl)).toBe(false);
    expect(Configuration.isSameKycBlob(azureUrl, undefined)).toBe(false);
    expect(Configuration.isSameKycBlob(undefined, undefined)).toBe(false);
  });

  // Falling back to full-URL equality here is exactly the pre-cutover silent-drop bug, so an
  // unexpected URL shape has to surface as an error.
  it('throws on a URL without the kyc/ container marker', () => {
    const malformed = 'https://files.dfx.swiss/other/user/42/CommercialRegister/hr-auszug.pdf';

    expect(() => Configuration.isSameKycBlob(malformed, minioUrl)).toThrow(
      /Unexpected KYC blob URL format \(missing 'kyc\/' marker\)/,
    );
  });
});
