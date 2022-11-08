import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CryptoInputRepository } from '../crypto-input.repository';
import { CryptoInputService } from '../crypto-input.service';

describe('CryptoInputService', () => {
  let service: CryptoInputService;

  let cryptoInputRepo: CryptoInputRepository;

  beforeEach(async () => {
    cryptoInputRepo = createMock<CryptoInputRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [CryptoInputService, { provide: CryptoInputRepository, useValue: cryptoInputRepo }],
    }).compile();

    service = module.get<CryptoInputService>(CryptoInputService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
