import {
  assertValidStorageCombo,
  Environment,
  GetConfig,
  StorageReadSource,
  StorageWriteMode,
} from 'src/config/config';

/**
 * The Azure Blob -> MinIO cutover is steered by two independent switches. Reading from a store that
 * receives no writes loses documents silently, so the pair is validated on every access instead of
 * once at boot — these tests pin that fail-loud behaviour and the one deliberate exception (LOC).
 */
describe('Config storage switches', () => {
  const backup = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    STORAGE_WRITE_MODE: process.env.STORAGE_WRITE_MODE,
    STORAGE_READ_SOURCE: process.env.STORAGE_READ_SOURCE,
    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('assertValidStorageCombo', () => {
    // Every combination in which the read side is actually fed by the write side.
    it.each([
      ['azure', 'azure'],
      ['dual', 'azure'],
      ['dual', 's3'],
      ['s3', 's3'],
    ] as [StorageWriteMode, StorageReadSource][])('accepts write=%s / read=%s', (writeMode, readSource) => {
      expect(() => assertValidStorageCombo(writeMode, readSource)).not.toThrow();
    });

    // The two crossed combinations read from a store nothing writes to — every upload would appear
    // to succeed while the download 404s.
    it.each([
      ['azure', 's3'],
      ['s3', 'azure'],
    ] as [StorageWriteMode, StorageReadSource][])('rejects write=%s / read=%s', (writeMode, readSource) => {
      expect(() => assertValidStorageCombo(writeMode, readSource)).toThrow(/Invalid storage config/);
    });
  });

  describe('Config.storage', () => {
    it('validates the pair on every access outside LOC', () => {
      process.env.ENVIRONMENT = Environment.DEV;
      const config = GetConfig();

      process.env.STORAGE_WRITE_MODE = 'dual';
      process.env.STORAGE_READ_SOURCE = 'azure';
      expect(config.storage).toEqual({ writeMode: 'dual', readSource: 'azure' });

      // Same instance, changed environment: the getter re-reads and re-validates rather than
      // caching the boot-time value.
      process.env.STORAGE_READ_SOURCE = 's3';
      expect(config.storage).toEqual({ writeMode: 'dual', readSource: 's3' });

      process.env.STORAGE_WRITE_MODE = 'azure';
      expect(() => config.storage).toThrow(/Invalid storage config/);
    });

    it('fails loud on a missing or unknown write mode', () => {
      process.env.ENVIRONMENT = Environment.DEV;
      process.env.STORAGE_READ_SOURCE = 's3';
      const config = GetConfig();

      delete process.env.STORAGE_WRITE_MODE;
      expect(() => config.storage).toThrow(/Missing\/invalid STORAGE_WRITE_MODE/);

      process.env.STORAGE_WRITE_MODE = 'minio';
      expect(() => config.storage).toThrow(/expected one of: azure, dual, s3/);
    });

    it('fails loud on a missing or unknown read source', () => {
      process.env.ENVIRONMENT = Environment.DEV;
      process.env.STORAGE_WRITE_MODE = 's3';
      const config = GetConfig();

      delete process.env.STORAGE_READ_SOURCE;
      expect(() => config.storage).toThrow(/Missing\/invalid STORAGE_READ_SOURCE/);

      process.env.STORAGE_READ_SOURCE = 'blob';
      expect(() => config.storage).toThrow(/expected one of: azure, s3/);
    });

    // LOC never reaches a real storage backend (the factory routes it to MockStorageService), so
    // the getter stays silent there — a local checkout without the migration vars must not throw
    // just because a test touched Config.storage.
    it('returns the raw values unvalidated in LOC', () => {
      process.env.ENVIRONMENT = Environment.LOC;
      delete process.env.STORAGE_WRITE_MODE;
      delete process.env.STORAGE_READ_SOURCE;

      expect(GetConfig().storage).toEqual({ writeMode: undefined, readSource: undefined });

      process.env.STORAGE_WRITE_MODE = 'azure';
      process.env.STORAGE_READ_SOURCE = 's3';

      // Even the crossed pair is passed through in LOC instead of throwing.
      expect(GetConfig().storage).toEqual({ writeMode: 'azure', readSource: 's3' });
    });
  });

  describe('azure.storage.url', () => {
    // The blob endpoint is embedded in the connection string; the public URL base is derived from
    // it so persisted blob URLs and the live client always agree on the host.
    it('extracts the blob endpoint from the connection string', () => {
      process.env.AZURE_STORAGE_CONNECTION_STRING =
        'DefaultEndpointsProtocol=https;AccountName=dfx;BlobEndpoint=https://dfx.blob.core.windows.net/;AccountKey=abc';

      expect(GetConfig().azure.storage.url).toBe('https://dfx.blob.core.windows.net/');
    });

    it('is undefined when the connection string carries no blob endpoint', () => {
      process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=dfx;AccountKey=abc';

      expect(GetConfig().azure.storage.url).toBeUndefined();
    });

    it('is undefined when no connection string is configured at all', () => {
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;

      const azure = GetConfig().azure;

      expect(azure.storage.url).toBeUndefined();
      expect(azure.storage.connectionString).toBeUndefined();
    });
  });
});
