import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { CfpService } from './cfp.service';
import { NodeService } from 'src/integration/blockchain/ain/node/node.service';

describe('CfpService', () => {
  let service: CfpService;
  let settingService: SettingService;
  let nodeService: NodeService;

  beforeEach(async () => {
    settingService = createMock<SettingService>();
    nodeService = createMock<NodeService>();

    jest.spyOn(settingService, 'getObj').mockResolvedValueOnce({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CfpService,
        { provide: HttpService, useValue: {} },
        { provide: SettingService, useValue: settingService },
        { provide: NodeService, useValue: nodeService },
        { provide: 'VALID_MNS', useValue: [] },
      ],
    }).compile();

    service = module.get<CfpService>(CfpService);
    await service.doUpdate();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the CFP list', () => {
    expect(service.getCfpList()).toEqual([
      '2301',
      '2211',
      '2208',
      '2207',
      '2206',
      '2205',
      '2203',
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
