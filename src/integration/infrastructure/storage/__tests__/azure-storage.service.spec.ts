import { BlobServiceClient } from '@azure/storage-blob';
import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { AzureStorageService } from '../azure-storage.service';

const CONTAINER = 'kyc';
const AZURE_URL = 'https://myaccount.blob.core.windows.net/';
const CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net;BlobEndpoint=https://myaccount.blob.core.windows.net/';

const validAzure = {
  storage: {
    url: AZURE_URL,
    connectionString: CONNECTION_STRING,
  },
};

// Hand-built Azure SDK stubs — no real network calls.
function mockBlobClient(
  overrides: {
    properties?: Record<string, unknown>;
    data?: Buffer;
    uploadData?: jest.Mock;
  } = {},
): { getProperties: jest.Mock; downloadToBuffer: jest.Mock; uploadData: jest.Mock } {
  return {
    getProperties: jest.fn().mockResolvedValue(
      overrides.properties ?? {
        contentType: 'application/pdf',
        createdOn: new Date('2026-01-01T00:00:00.000Z'),
        lastModified: new Date('2026-01-02T00:00:00.000Z'),
        metadata: { kind: 'id' },
      },
    ),
    downloadToBuffer: jest.fn().mockResolvedValue(overrides.data ?? Buffer.from('blob-data')),
    uploadData: overrides.uploadData ?? jest.fn().mockResolvedValue(undefined),
  };
}

function mockContainerClient(
  opts: {
    blobItems?: Array<{ name: string; properties?: Record<string, unknown>; metadata?: Record<string, string> }>;
    blobClient?: ReturnType<typeof mockBlobClient>;
  } = {},
): { listBlobsFlat: jest.Mock; getBlockBlobClient: jest.Mock; _blobClient: ReturnType<typeof mockBlobClient> } {
  const blobClient = opts.blobClient ?? mockBlobClient();
  const blobItems = opts.blobItems ?? [];

  const iterator = {
    next: jest
      .fn()
      .mockResolvedValueOnce({
        value: { segment: { blobItems } },
        done: true,
      })
      .mockResolvedValue({ value: undefined, done: true }),
  };

  return {
    listBlobsFlat: jest.fn().mockReturnValue({
      byPage: jest.fn().mockReturnValue(iterator),
    }),
    getBlockBlobClient: jest.fn().mockReturnValue(blobClient),
    _blobClient: blobClient,
  };
}

async function provideConfig(azure: Partial<typeof validAzure> = validAzure): Promise<void> {
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig({ azure: { ...validAzure, ...azure } as typeof validAzure })],
  }).compile();
}

describe('AzureStorageService', () => {
  let fromConnectionString: jest.SpyInstance;
  let containerClient: ReturnType<typeof mockContainerClient>;

  beforeEach(async () => {
    containerClient = mockContainerClient();
    fromConnectionString = jest.spyOn(BlobServiceClient, 'fromConnectionString').mockReturnValue({
      getContainerClient: jest.fn().mockReturnValue(containerClient),
    } as never);
    await provideConfig();
  });

  afterEach(() => {
    fromConnectionString.mockRestore();
  });

  describe('constructor / lazy client', () => {
    it('constructs without reading Config / touching the client', async () => {
      await provideConfig({ storage: { url: AZURE_URL, connectionString: undefined } });

      expect(() => new AzureStorageService(CONTAINER)).not.toThrow();
      expect(fromConnectionString).not.toHaveBeenCalled();
    });

    it('throws Incomplete Azure config on first I/O when connectionString is missing', async () => {
      await provideConfig({ storage: { url: AZURE_URL, connectionString: undefined } });

      await expect(new AzureStorageService(CONTAINER).getBlob('x')).rejects.toThrow(
        'Incomplete Azure config: connectionString is required',
      );
    });

    it('throws when connectionString is present but url is missing (no BlobEndpoint segment)', async () => {
      await provideConfig({
        storage: {
          url: undefined,
          connectionString:
            'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net',
        },
      });

      await expect(new AzureStorageService(CONTAINER).getBlob('x')).rejects.toThrow(
        'Azure storage URL could not be derived from AZURE_STORAGE_CONNECTION_STRING (missing BlobEndpoint segment); cannot build blob URLs',
      );
    });
  });

  describe('blobUrl / blobName round-trip', () => {
    it('builds an Azure-host URL and reverses it, including encoded segments', () => {
      const service = new AzureStorageService(CONTAINER);
      const name = 'user/1/my file.png';

      const url = service.blobUrl(name);

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/user/1/my%20file.png`);
      expect(service.blobName(url)).toBe(name);
    });

    it('throws blobName for a URL outside the container', () => {
      const service = new AzureStorageService(CONTAINER);

      expect(() => service.blobName(`${AZURE_URL}other/x.png`)).toThrow('URL does not belong to container kyc');
    });
  });

  describe('uploadBlob', () => {
    it('uploads via BlockBlobClient and returns the Azure blob URL', async () => {
      const uploadData = jest.fn().mockResolvedValue(undefined);
      containerClient = mockContainerClient({ blobClient: mockBlobClient({ uploadData }) });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const data = Buffer.from('hello');
      const url = await new AzureStorageService(CONTAINER).uploadBlob('user/1/file.txt', data, 'text/plain', {
        owner: 'u1',
      });

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/user/1/file.txt`);
      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith('user/1/file.txt');
      expect(uploadData).toHaveBeenCalledWith(data, {
        blobHTTPHeaders: { blobContentType: 'text/plain' },
        metadata: { owner: 'u1' },
      });
    });
  });

  describe('getBlob', () => {
    it('returns the decoded body with metadata', async () => {
      const data = Buffer.from([1, 2, 3]);
      const created = new Date('2026-01-01T00:00:00.000Z');
      const updated = new Date('2026-01-02T00:00:00.000Z');
      containerClient = mockContainerClient({
        blobClient: mockBlobClient({
          data,
          properties: {
            contentType: 'application/pdf',
            createdOn: created,
            lastModified: updated,
            metadata: { source: 'kyc' },
          },
        }),
      });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const res = await new AzureStorageService(CONTAINER).getBlob('doc.pdf');

      expect(res.data.equals(data)).toBe(true);
      expect(res.contentType).toBe('application/pdf');
      expect(res.created).toBe(created);
      expect(res.updated).toBe(updated);
      expect(res.metadata).toEqual({ source: 'kyc' });
    });
  });

  describe('listBlobs / listKeys', () => {
    it('listBlobs maps properties and builds Azure URLs', async () => {
      const created = new Date('2026-01-01T00:00:00.000Z');
      containerClient = mockContainerClient({
        blobItems: [
          {
            name: 'user/1/a.png',
            properties: {
              contentType: 'image/png',
              createdOn: created,
              lastModified: created,
              metadata: { kind: 'id' },
            },
            metadata: { kind: 'id' },
          },
        ],
      });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const blobs = await new AzureStorageService(CONTAINER).listBlobs('user/1/');

      expect(blobs).toEqual([
        {
          name: 'user/1/a.png',
          url: `${AZURE_URL}${CONTAINER}/user/1/a.png`,
          contentType: 'image/png',
          created,
          updated: created,
          metadata: { kind: 'id' },
        },
      ]);
      expect(containerClient.listBlobsFlat).toHaveBeenCalledWith({ prefix: 'user/1/', includeMetadata: true });
    });

    it('listKeys returns only names (no property mapping)', async () => {
      containerClient = mockContainerClient({
        blobItems: [{ name: 'a' }, { name: 'b' }],
      });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const keys = await new AzureStorageService(CONTAINER).listKeys('pref/');

      expect(keys).toEqual(['a', 'b']);
      expect(containerClient.listBlobsFlat).toHaveBeenCalledWith({ prefix: 'pref/' });
    });
  });

  describe('copyBlobs', () => {
    it('copies source blobs and returns the target keys', async () => {
      const data = Buffer.from('payload');
      const created = new Date('2026-01-01T00:00:00.000Z');
      const uploadData = jest.fn().mockResolvedValue(undefined);
      const blobClient = mockBlobClient({
        data,
        uploadData,
        properties: {
          contentType: 'text/plain',
          createdOn: created,
          lastModified: created,
          metadata: { m: '1' },
        },
      });

      // listBlobs uses listBlobsFlat; getBlob/uploadBlob use getBlockBlobClient
      containerClient = mockContainerClient({
        blobItems: [
          {
            name: 'src/file.txt',
            properties: {
              contentType: 'text/plain',
              createdOn: created,
              lastModified: created,
              metadata: { m: '1' },
            },
            metadata: { m: '1' },
          },
        ],
        blobClient,
      });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const targetKeys = await new AzureStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(targetKeys).toEqual(['dst/file.txt']);
      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith('src/file.txt');
      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith('dst/file.txt');
      expect(uploadData).toHaveBeenCalled();
    });

    it('returns [] for an empty source prefix without throwing', async () => {
      containerClient = mockContainerClient({ blobItems: [] });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      await expect(new AzureStorageService(CONTAINER).copyBlobs('src/', 'dst/')).resolves.toEqual([]);
    });
  });

  describe('uploadWormBlob', () => {
    it('delegates to uploadBlob (no Object-Lock check)', async () => {
      const uploadData = jest.fn().mockResolvedValue(undefined);
      containerClient = mockContainerClient({ blobClient: mockBlobClient({ uploadData }) });
      fromConnectionString.mockReturnValue({
        getContainerClient: jest.fn().mockReturnValue(containerClient),
      } as never);

      const url = await new AzureStorageService(CONTAINER).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/settlement.ep2`);
      expect(uploadData).toHaveBeenCalledTimes(1);
      // Azure has no Object Lock probe — only the upload path is exercised.
      expect(fromConnectionString).toHaveBeenCalledTimes(1);
    });
  });
});
