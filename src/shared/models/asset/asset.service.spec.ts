import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
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

  it('should switch to DFI-Token if isToken = true and DFI', () => {
    service.getAssetByQuery({ dexName: 'DFI', blockchain: Blockchain.DEFICHAIN, isToken: true });

    expect(assetRepo.findOne).toHaveBeenCalledWith({ where: { dexName: 'DFI-Token' } });
  });

  it('should not switch to DFI-Token if isToken = false and DFI', () => {
    service.getAssetByQuery({ dexName: 'DFI', blockchain: Blockchain.DEFICHAIN, isToken: false });

    expect(assetRepo.findOne).toHaveBeenCalledWith({ where: { dexName: 'DFI' } });
  });

  it('should not switch to DFI-Token if isToken = undefined and DFI', () => {
    service.getAssetByQuery({ dexName: 'DFI', blockchain: Blockchain.DEFICHAIN });

    expect(assetRepo.findOne).toHaveBeenCalledWith({ where: { dexName: 'DFI' } });
  });

  it('should not switch to DFI-Token if isToken = true and not DFI', () => {
    service.getAssetByQuery({ dexName: 'BTC', blockchain: Blockchain.BITCOIN, isToken: true });

    expect(assetRepo.findOne).toHaveBeenCalledWith({ where: { dexName: 'BTC' } });
  });
});
