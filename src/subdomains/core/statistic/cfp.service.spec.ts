import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { CfpService } from './cfp.service';
import { NodeService } from 'src/integration/blockchain/ain/node/node.service';

describe('CfpService', () => {
  let service: CfpService;
  let nodeService: NodeService;

  beforeEach(async () => {
    nodeService = createMock<NodeService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CfpService,
        { provide: HttpService, useValue: {} },
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
});
