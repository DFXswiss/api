import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from '../crypto.service';

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

  it('should return true for address bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234', () => {
    expect(service.isBitcoinAddress('bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234')).toBeTruthy();
  });

  it('should return true for address 3CBMMXCFVjosAJkgdroNPNiUHHZytG1324', () => {
    expect(service.isBitcoinAddress('3CBMMXCFVjosAJkgdroNPNiUHHZytG1324')).toBeTruthy();
  });

  it('should return true for address 1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234', () => {
    expect(service.isBitcoinAddress('1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234')).toBeTruthy();
  });

  it('should return false for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(service.isBitcoinAddress('0x2d84553B3A4753009A314106d58F0CC21f441234')).toBeFalsy();
  });

  it('should return false for address tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234', () => {
    expect(service.isBitcoinAddress('tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234')).toBeFalsy();
  });
});
