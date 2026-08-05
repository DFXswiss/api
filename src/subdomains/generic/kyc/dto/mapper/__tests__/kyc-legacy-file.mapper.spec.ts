import { FileSubType, FileType } from '../../kyc-file.dto';
import { LegacyFileSkipReason } from '../../kyc-legacy-file.dto';
import { KycLegacyFileMapper } from '../kyc-legacy-file.mapper';

describe('KycLegacyFileMapper', () => {
  const userDataId = 1234;

  function map(keys: string[]) {
    return KycLegacyFileMapper.toCatalogEntries(userDataId, keys);
  }

  describe('file filter', () => {
    it('catalogs only document extensions', () => {
      const { entries, skipped } = map([
        `spider/${userDataId}/user-added-document/proof.pdf`,
        `spider/${userDataId}/user-added-document/scan.JPG`,
        `spider/${userDataId}/user-added-document/photo.jpeg`,
        `spider/${userDataId}/user-added-document/shot.png`,
        `spider/${userDataId}/video_identification/call.mp4`,
        `spider/${userDataId}/video_identification/call.mp3`,
        `spider/${userDataId}/online-identification/result.json`,
        `spider/${userDataId}/online-identification/report.xml`,
        `spider/${userDataId}/user-added-document/mail.eml`,
        `spider/${userDataId}/user-added-document/contract.docx`,
        `spider/${userDataId}/user-added-document/archive.zip`,
        `spider/${userDataId}/user-added-document/image.heic`,
      ]);

      expect(entries.map((e) => e.path.split('/').pop())).toEqual([
        'photo.jpeg',
        'proof.pdf',
        'scan.JPG',
        'shot.png',
        'call.mp3',
        'call.mp4',
      ]);
      expect(skipped.filter((s) => s === LegacyFileSkipReason.UNSUPPORTED_EXTENSION)).toHaveLength(6);
    });

    it('skips keys of a foreign owner and keys without a file name', () => {
      const { entries, skipped } = map([
        `spider/9999/user-added-document/proof.pdf`,
        `user/${userDataId}/Identification/proof.pdf`,
        `spider/${userDataId}/user-added-document/`,
        `spider/${userDataId}/user-added-document/no-extension`,
      ]);

      expect(entries).toHaveLength(0);
      expect(skipped.filter((s) => s === LegacyFileSkipReason.INVALID_PATH)).toHaveLength(3);
      expect(skipped.filter((s) => s === LegacyFileSkipReason.UNSUPPORTED_EXTENSION)).toHaveLength(1);
    });

    it('catalogs both prefixes of one account', () => {
      const { entries } = map([
        `spider/${userDataId}/user-added-document/personal.pdf`,
        `spider/${userDataId}-organization/registry_commerce/company.pdf`,
      ]);

      expect(entries.map((e) => e.type)).toEqual([FileType.COMMERCIAL_REGISTER, FileType.USER_NOTES]);
      expect(entries.every((e) => e.userDataId === userDataId)).toBe(true);
    });
  });

  describe('name checks', () => {
    it('catalogs the newest run only', () => {
      const { entries, skipped } = map([
        `spider/${userDataId}/check/gen_2/check.pdf`,
        `spider/${userDataId}/check/gen_10/check.pdf`,
        `spider/${userDataId}/check/gen_9/check.pdf`,
      ]);

      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe(`spider/${userDataId}/check/gen_10/check.pdf`);
      expect(entries[0].type).toBe(FileType.NAME_CHECK);
      expect(entries[0].subType).toBe(FileSubType.PERSONAL_NAME_CHECK);
      expect(skipped).toEqual(Array(2).fill(LegacyFileSkipReason.SUPERSEDED_NAME_CHECK));
    });

    it('keeps the newest run of each prefix and marks the organization one as a business check', () => {
      const { entries } = map([
        `spider/${userDataId}/check/gen_1/check.pdf`,
        `spider/${userDataId}/check/gen_2/check.pdf`,
        `spider/${userDataId}-organization/check/gen_1/check.pdf`,
      ]);

      expect(entries.map((e) => [e.path, e.subType])).toEqual([
        [`spider/${userDataId}-organization/check/gen_1/check.pdf`, FileSubType.BUSINESS_NAME_CHECK],
        [`spider/${userDataId}/check/gen_2/check.pdf`, FileSubType.PERSONAL_NAME_CHECK],
      ]);
    });

    it('does not let a run without documents supersede an older one', () => {
      const { entries } = map([
        `spider/${userDataId}/check/gen_1/check.pdf`,
        `spider/${userDataId}/check/gen_2/check.json`,
      ]);

      expect(entries.map((e) => e.path)).toEqual([`spider/${userDataId}/check/gen_1/check.pdf`]);
    });

    it('keeps a check file that belongs to no run', () => {
      const { entries } = map([
        `spider/${userDataId}/check/loose.pdf`,
        `spider/${userDataId}/check/gen_1/check.pdf`,
        `spider/${userDataId}/check/gen_2/check.pdf`,
      ]);

      expect(entries.map((e) => e.path)).toEqual([
        `spider/${userDataId}/check/gen_2/check.pdf`,
        `spider/${userDataId}/check/loose.pdf`,
      ]);
    });
  });

  describe('folder mapping', () => {
    it('maps the ident folders by file kind', () => {
      const { entries } = map([
        `spider/${userDataId}/online-identification/1699356511987/report.pdf`,
        `spider/${userDataId}/online-identification/1699356511987/userface.jpg`,
        `spider/${userDataId}/online-identification/1699356511987/liveness.png`,
        `spider/${userDataId}/online-identification/1699356511987/security.jpg`,
        `spider/${userDataId}/online-identification/1699356511987/idcard-front.jpg`,
        `spider/${userDataId}/video_identification/1699356511987/protocol.pdf`,
        `spider/${userDataId}/video_identification/1699356511987/recording.mp4`,
        `spider/${userDataId}/video_identification/1699356511987/audio.mp3`,
      ]);

      expect(entries.every((e) => e.type === FileType.IDENTIFICATION)).toBe(true);
      expect(Object.fromEntries(entries.map((e) => [e.path.split('/').pop(), e.subType]))).toEqual({
        'report.pdf': FileSubType.IDENT_REPORT,
        'userface.jpg': FileSubType.IDENT_SELFIE,
        'liveness.png': FileSubType.IDENT_SELFIE,
        'security.jpg': FileSubType.IDENT_SELFIE,
        'idcard-front.jpg': FileSubType.IDENT_DOC,
        'protocol.pdf': FileSubType.IDENT_REPORT,
        'recording.mp4': FileSubType.IDENT_RECORDING,
        'audio.mp3': FileSubType.IDENT_RECORDING,
      });
    });

    it('maps the remaining folders and falls back to additional documents', () => {
      const { entries } = map([
        `spider/${userDataId}/passport_or_id/passport.jpg`,
        `spider/${userDataId}/chatbot-onboarding/onboarding.pdf`,
        `spider/${userDataId}/user-added-document/upload.pdf`,
        `spider/${userDataId}-organization/incorporation_certificate/certificate.pdf`,
        `spider/${userDataId}-organization/registry_commerce/extract.pdf`,
        `spider/${userDataId}/some-unknown-folder/file.pdf`,
        `spider/${userDataId}/loose.pdf`,
      ]);

      expect(entries.map((e) => [e.path.split('/').pop(), e.type, e.subType])).toEqual([
        ['certificate.pdf', FileType.COMMERCIAL_REGISTER, undefined],
        ['extract.pdf', FileType.COMMERCIAL_REGISTER, undefined],
        ['onboarding.pdf', FileType.USER_NOTES, FileSubType.ONBOARDING_REPORT],
        ['loose.pdf', FileType.ADDITIONAL_DOCUMENTS, undefined],
        ['passport.jpg', FileType.IDENTIFICATION, FileSubType.IDENT_DOC],
        ['file.pdf', FileType.ADDITIONAL_DOCUMENTS, undefined],
        ['upload.pdf', FileType.USER_NOTES, undefined],
      ]);
    });
  });

  describe('names', () => {
    it('keeps the plain file name where it is unambiguous', () => {
      const { entries } = map([
        `spider/${userDataId}/online-identification/1699356511987/report.pdf`,
        `spider/${userDataId}/user-added-document/report.pdf`,
      ]);

      expect(entries.map((e) => e.name)).toEqual(['report.pdf', 'report.pdf']);
    });

    it('qualifies a name that collides within its file type with the parent folder', () => {
      const { entries } = map([
        `spider/${userDataId}/online-identification/1699356511987/report.pdf`,
        `spider/${userDataId}/online-identification/1755000000000/report.pdf`,
      ]);

      expect(entries.map((e) => e.name)).toEqual(['report.pdf', '1755000000000/report.pdf']);
    });

    it('falls back to the full path when the parent folder collides too', () => {
      const { entries } = map([
        `spider/${userDataId}/folder-a/x/doc.pdf`,
        `spider/${userDataId}/folder-b/x/doc.pdf`,
        `spider/${userDataId}/folder-c/x/doc.pdf`,
      ]);

      expect(entries.map((e) => e.name)).toEqual(['doc.pdf', 'x/doc.pdf', 'folder-c/x/doc.pdf']);
    });
  });
});
