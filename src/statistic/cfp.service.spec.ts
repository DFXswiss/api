import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/ain/services/crypto.service';
import { HttpService } from 'src/shared/services/http.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { CfpService } from './cfp.service';
import { MasternodeService } from 'src/payment/models/masternode/masternode.service';

describe('CfpService', () => {
  let service: CfpService;
  let settingService: SettingService;
  let masternodeService: MasternodeService;

  beforeEach(async () => {
    settingService = createMock<SettingService>();
    masternodeService = createMock<MasternodeService>();

    jest.spyOn(settingService, 'getObj').mockResolvedValueOnce({});
    jest.spyOn(masternodeService, 'getObj').mockResolvedValueOnce({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CfpService,
        { provide: HttpService, useValue: {} },
        { provide: CryptoService, useValue: {} },
        { provide: SettingService, useValue: settingService },
        { provide: MasternodeService, useValue: masternodeService },
        { provide: 'VALID_MNS', useValue: [] },
      ],
    }).compile();

    service = module.get<CfpService>(CfpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the CFP list', () => {
    expect(service.getCfpList()).toEqual([
      '2202',
      '2201',
      '2112',
      '2111',
      '2109',
      '2107',
      '2106',
      '2104',
      '2101',
      '2009',
    ]);
  });

  it('should return 2109 CFPs', async () => {
    await expect(service.getCfpResults('2109')).resolves.toHaveLength(18);
  });
});
