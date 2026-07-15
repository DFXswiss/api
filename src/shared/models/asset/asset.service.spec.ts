import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IsNull, Not } from 'typeorm';
import { Asset, AssetType } from './asset.entity';
import { AssetRepository } from './asset.repository';
import { AssetService } from './asset.service';

describe('AssetService', () => {
  let service: AssetService;

  let assetRepo: AssetRepository;

  beforeEach(async () => {
    assetRepo = createMock<AssetRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AssetService, { provide: AssetRepository, useValue: assetRepo }],
    }).compile();

    service = module.get<AssetService>(AssetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPayInAssets', () => {
    const dgcChainId = '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f';
    const zchf = {
      blockchain: Blockchain.POLYGON,
      type: AssetType.TOKEN,
      chainId: '0x02567e4b14b25549331fcee2b56c647a8bab16fd',
      priceRule: { id: 2 },
    } as unknown as Asset;

    it('queries only priced assets (excludes inert/unpriced tokens at the DB level)', async () => {
      const findCached = jest.spyOn(assetRepo, 'findCached').mockResolvedValue([]);

      await service.getPayInAssets([Blockchain.POLYGON]);

      const options = findCached.mock.calls[0][1];
      expect(options.where).toMatchObject({ priceRule: Not(IsNull()) });
    });

    it('uses only the DB-filtered set for chain-id matching', async () => {
      jest.spyOn(assetRepo, 'findCached').mockResolvedValue([zchf]);

      const payInAssets = await service.getPayInAssets([Blockchain.POLYGON]);

      expect(service.getByChainIdSync(payInAssets, Blockchain.POLYGON, zchf.chainId)).toBe(zchf);
      expect(service.getByChainIdSync(payInAssets, Blockchain.POLYGON, dgcChainId)).toBeUndefined();
    });
  });
});
