import { Configuration } from 'src/config/config';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

/**
 * Regression guard for the Azure Blob -> MinIO (S3) storage cutover.
 *
 * kyc_step.result persists the FULL blob URL captured at upload time (Azure host before the
 * cutover), while the compliance ZIP builder regenerates each KycFileBlob.url live from the
 * CURRENT storage backend (MinIO host after the cutover). The GwG download config entries 11
 * (Handelsregisterauszug) and 12 (Vollmacht) select the KYC document by comparing those two
 * URLs. With the previous full-URL string equality the hosts never matched after the cutover,
 * so both documents were silently dropped from the compliance ZIP for every pre-cutover
 * organization customer — no error, just missing files. The comparison is now host-independent
 * (container-relative, decoded object key), which must match legacy Azure-host and new
 * MinIO-host values alike.
 */
describe('fileDownloadConfig - host-independent KYC document selection (storage cutover)', () => {
  const config = new Configuration();

  // Same container-relative object key, served from two different storage hosts.
  const key = 'user/42/CommercialRegister/hr-auszug.pdf';
  const legacyAzureUrl = `https://dfxstorageprd.blob.core.windows.net/kyc/${key}`;
  const liveMinioUrl = `https://files.dfx.swiss/kyc/${key}`;

  function fileWithUrl(url: string, path: string): KycFileBlob {
    return { url, path } as unknown as KycFileBlob;
  }

  function step(partial: Record<string, unknown>): KycStep {
    return { isCompleted: true, ...partial } as unknown as KycStep;
  }

  function filterFor(id: number): (file: KycFileBlob, userData: UserData) => boolean {
    const entry = config.fileDownloadConfig.find((c) => c.id === id);
    if (!entry?.files[0].filter) throw new Error(`no filter for fileDownloadConfig id ${id}`);
    return entry.files[0].filter;
  }

  describe('isSameKycBlob', () => {
    it('treats the same object key served from Azure and MinIO hosts as equal', () => {
      expect(Configuration.isSameKycBlob(legacyAzureUrl, liveMinioUrl)).toBe(true);
    });

    it('is robust to percent-encoded path segments (space in the file name)', () => {
      const encodedAzure = 'https://dfxstorageprd.blob.core.windows.net/kyc/user/42/Authority/HR%20Vollmacht.pdf';
      const encodedMinio = 'https://files.dfx.swiss/kyc/user/42/Authority/HR%20Vollmacht.pdf';
      expect(Configuration.isSameKycBlob(encodedAzure, encodedMinio)).toBe(true);
    });

    it('does not match different object keys', () => {
      const otherMinio = 'https://files.dfx.swiss/kyc/user/42/CommercialRegister/other.pdf';
      expect(Configuration.isSameKycBlob(legacyAzureUrl, otherMinio)).toBe(false);
    });

    it('returns false when either value is missing (fails closed, no throw)', () => {
      expect(Configuration.isSameKycBlob(undefined, liveMinioUrl)).toBe(false);
      expect(Configuration.isSameKycBlob(legacyAzureUrl, undefined)).toBe(false);
    });

    // A URL without the container marker must not fall back to full-URL equality (that was the
    // pre-cutover silent-drop bug). Fail loud so a malformed stored/live URL surfaces as an error
    // instead of quietly excluding Handelsregisterauszug / Vollmacht from the compliance ZIP.
    it('throws when a URL is missing the kyc/ container marker', () => {
      const malformed = 'https://files.dfx.swiss/other-container/user/42/CommercialRegister/hr-auszug.pdf';
      expect(() => Configuration.isSameKycBlob(malformed, liveMinioUrl)).toThrow(
        /Unexpected KYC blob URL format \(missing 'kyc\/' marker\)/,
      );
      expect(() => Configuration.isSameKycBlob(legacyAzureUrl, malformed)).toThrow(
        /Unexpected KYC blob URL format \(missing 'kyc\/' marker\)/,
      );
    });
  });

  describe('id 11 - Handelsregisterauszug', () => {
    const filter = filterFor(11);

    it('selects the doc when the stored COMMERCIAL_REGISTER result is a legacy Azure URL and the live file.url is MinIO', () => {
      const userData = {
        kycSteps: [step({ name: KycStepName.COMMERCIAL_REGISTER, result: legacyAzureUrl })],
      } as unknown as UserData;

      // Precondition: the two URLs are NOT string-equal (this is exactly what silently broke before).
      expect(legacyAzureUrl).not.toEqual(liveMinioUrl);

      expect(filter(fileWithUrl(liveMinioUrl, key), userData)).toBe(true);
    });

    it('selects the doc for a LEGAL_ENTITY step whose stored getResult().url is a legacy Azure URL', () => {
      const userData = {
        kycSteps: [
          step({
            name: KycStepName.LEGAL_ENTITY,
            getResult: () => ({ url: legacyAzureUrl, legalEntity: 'AG' }),
          }),
        ],
      } as unknown as UserData;

      expect(filter(fileWithUrl(liveMinioUrl, key), userData)).toBe(true);
    });

    it('does not select an unrelated document (different object key)', () => {
      const userData = {
        kycSteps: [step({ name: KycStepName.COMMERCIAL_REGISTER, result: legacyAzureUrl })],
      } as unknown as UserData;

      const otherLive = 'https://files.dfx.swiss/kyc/user/42/CommercialRegister/unrelated.pdf';
      expect(filter(fileWithUrl(otherLive, 'user/42/CommercialRegister/unrelated.pdf'), userData)).toBe(false);
    });
  });

  describe('id 12 - Vollmacht', () => {
    const filter = filterFor(12);

    it('selects the doc when the stored AUTHORITY result is a legacy Azure URL and the live file.url is MinIO', () => {
      const authorityKey = 'user/42/Authority/vollmacht.pdf';
      const storedAzure = `https://dfxstorageprd.blob.core.windows.net/kyc/${authorityKey}`;
      const liveMinio = `https://files.dfx.swiss/kyc/${authorityKey}`;

      const userData = {
        kycSteps: [step({ name: KycStepName.AUTHORITY, result: storedAzure })],
      } as unknown as UserData;

      expect(filter(fileWithUrl(liveMinio, authorityKey), userData)).toBe(true);
    });
  });
});
