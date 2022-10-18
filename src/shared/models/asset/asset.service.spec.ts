import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
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
});
