import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/ain/services/crypto.service';
import { HttpService } from 'src/shared/services/http.service';
import { CfpService } from './cfp.service';

describe('CfpService', () => {
  let service: CfpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CfpService, { provide: HttpService, useValue: {} }, { provide: CryptoService, useValue: {} }],
    }).compile();

    service = module.get<CfpService>(CfpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the CFP list', () => {
    expect(service.getCfpList()).toEqual(['2111', '2109', '2107', '2106', '2104', '2101', '2009']);
  });

  it('should return 2109 CFPs', () => {
    expect(service.getCfpResults('2109')).resolves.toHaveLength(18);
  });
});
