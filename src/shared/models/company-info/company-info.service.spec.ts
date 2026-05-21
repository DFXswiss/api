import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyInfo } from './company-info.entity';
import { CompanyInfoRepository } from './company-info.repository';
import { CompanyInfoService } from './company-info.service';

const buildInfo = (overrides: Partial<CompanyInfo> = {}): CompanyInfo =>
  Object.assign(new CompanyInfo(), {
    id: 1,
    brand: 'RealUnit',
    name: 'RealUnit Schweiz AG',
    phone: '+41 41 761 00 90',
    email: 'info@realunit.ch',
    website: 'realunit.ch',
    addressStreet: 'Schochenmühlestrasse 6',
    addressZip: '6340',
    addressCity: 'Baar',
    addressCountry: 'CH',
    enabled: true,
    ...overrides,
  });

describe('CompanyInfoService', () => {
  let service: CompanyInfoService;
  let repo: jest.Mocked<CompanyInfoRepository>;

  beforeEach(async () => {
    repo = createMock<CompanyInfoRepository>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompanyInfoService, { provide: CompanyInfoRepository, useValue: repo }],
    }).compile();
    service = module.get<CompanyInfoService>(CompanyInfoService);
  });

  it('returns the enabled CompanyInfo for the requested brand', async () => {
    const info = buildInfo();
    repo.findOneCachedBy.mockResolvedValueOnce(info);

    const result = await service.getForBrand('RealUnit');

    expect(result).toBe(info);
    expect(repo.findOneCachedBy).toHaveBeenCalledWith('brand:realunit', {
      brand: 'RealUnit',
      enabled: true,
    });
  });

  it('throws NotFoundException when the brand is unknown', async () => {
    repo.findOneCachedBy.mockResolvedValueOnce(undefined);

    await expect(service.getForBrand('Unknown')).rejects.toThrow(NotFoundException);
  });
});
