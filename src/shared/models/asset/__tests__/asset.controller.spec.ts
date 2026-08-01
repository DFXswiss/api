import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  TransactionDirection,
  TransactionSpecification,
} from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from 'src/subdomains/supporting/payment/repositories/transaction-specification.repository';
import { EntityManager } from 'typeorm';
import { RepositoryFactory } from '../../../repositories/repository.factory';
import { createCustomAsset } from '../__mocks__/asset.entity.mock';
import { AssetController } from '../asset.controller';
import { AssetService } from '../asset.service';

function createSpec(values: Partial<TransactionSpecification>): TransactionSpecification {
  return Object.assign(new TransactionSpecification(), {
    system: Blockchain.ETHEREUM,
    minVolume: 1,
    minFee: 0,
    ...values,
  });
}

// The specifications must come from the cache: find() is stubbed to reject, so an uncached read fails the
// test instead of silently passing.
describe('AssetController.getAllAsset', () => {
  const usdt = createCustomAsset({ dexName: 'USDT', sellable: true, approxPriceChf: 1 });
  const specs = [createSpec({ asset: 'USDT', direction: TransactionDirection.OUT, minVolume: 4 })];

  let controller: AssetController;
  let assetService: DeepMocked<AssetService>;
  let specRepo: TransactionSpecificationRepository;
  let find: jest.SpyInstance;
  let findCached: jest.SpyInstance;

  beforeAll(() => new ConfigService()); // sets module-level Config (AssetDtoMapper reads tradingLimits)

  beforeEach(() => {
    assetService = createMock<AssetService>();
    specRepo = new TransactionSpecificationRepository(createMock<EntityManager>());

    find = jest.spyOn(specRepo, 'find').mockRejectedValue(new Error('uncached specification query'));
    findCached = jest.spyOn(specRepo, 'findCached').mockResolvedValue(specs);

    assetService.getAllBlockchainAssets.mockResolvedValue([usdt]);

    controller = new AssetController(assetService, {
      transactionSpecification: specRepo,
    } as unknown as RepositoryFactory);
  });

  it('reads the specifications from the cache', async () => {
    await controller.getAllAsset(undefined, { includePrivate: 'false' });

    expect(findCached).toHaveBeenCalledTimes(1);
    expect(findCached).toHaveBeenCalledWith('all');
    expect(find).not.toHaveBeenCalled();
  });

  it('applies the cached specification to the returned limits', async () => {
    const [dto] = await controller.getAllAsset(undefined, { includePrivate: 'false' });

    expect(dto.limits.minVolume).toBe(4);
  });

  it('picks the outgoing specification of the asset', async () => {
    findCached.mockResolvedValue([
      createSpec({ asset: 'USDT', direction: TransactionDirection.IN, minVolume: 222 }),
      createSpec({ asset: 'USDT', direction: TransactionDirection.OUT, minVolume: 8 }),
    ]);

    const [dto] = await controller.getAllAsset(undefined, { includePrivate: 'false' });

    expect(dto.limits.minVolume).toBe(8);
  });
});
