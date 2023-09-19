import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { NodeService } from '../../node/node.service';

describe('CryptoService', () => {
  let service: CryptoService;

  let lightningService: LightningService;
  let nodeService: NodeService;
  let evmRegistryService: EvmRegistryService;

  beforeEach(async () => {
    lightningService = createMock<LightningService>();
    nodeService = createMock<NodeService>();
    evmRegistryService = createMock<EvmRegistryService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: LightningService, useValue: lightningService },
        { provide: NodeService, useValue: nodeService },
        { provide: EvmRegistryService, useValue: evmRegistryService },
        TestUtil.provideConfig(),
      ],
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

  it('should return Blockchain.BITCOIN for address bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus', () => {
    expect(service.getBlockchainsBasedOn('bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus')).toEqual([
      Blockchain.BITCOIN,
    ]);
  });

  it('should return Blockchain.ETHEREUM and Blockchain.BINANCE_SMART_CHAIN for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(service.getBlockchainsBasedOn('0x2d84553B3A4753009A314106d58F0CC21f441234')).toEqual([
      Blockchain.ETHEREUM,
      Blockchain.BINANCE_SMART_CHAIN,
      Blockchain.ARBITRUM,
      Blockchain.OPTIMISM,
      Blockchain.POLYGON,
    ]);
  });

  it('should return Blockchain.DEFICHAIN for address tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234', () => {
    expect(service.getBlockchainsBasedOn('tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234')).toEqual([Blockchain.DEFICHAIN]);
  });

  it('should return Blockchain.LIGHTNING for address LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM', () => {
    expect(
      service.getBlockchainsBasedOn(
        'LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM',
      ),
    ).toEqual([Blockchain.LIGHTNING]);
  });
});
