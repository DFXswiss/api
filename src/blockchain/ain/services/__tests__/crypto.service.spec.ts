import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/blockchain/ain/services/crypto.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return Blockchain.BITCOIN for address bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234', () => {
    expect(service.getBlockchainsBasedOn('bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.BITCOIN for address 3CBMMXCFVjosAJkgdroNPNiUHHZytG1324', () => {
    expect(service.getBlockchainsBasedOn('3CBMMXCFVjosAJkgdroNPNiUHHZytG1324')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.BITCOIN for address 1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234', () => {
    expect(service.getBlockchainsBasedOn('1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.ETHEREUM and Blockchain.BINANCE_SMART_CHAIN for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(service.getBlockchainsBasedOn('0x2d84553B3A4753009A314106d58F0CC21f441234')).toEqual([
      Blockchain.ETHEREUM,
      Blockchain.BINANCE_SMART_CHAIN,
    ]);
  });

  it('should return Blockchain.DEFICHAIN for address tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234', () => {
    expect(service.getBlockchainsBasedOn('tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234')).toEqual([Blockchain.DEFICHAIN]);
  });
});
