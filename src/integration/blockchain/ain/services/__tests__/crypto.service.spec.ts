import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArweaveService } from 'src/integration/blockchain/arweave/services/arweave.service';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { NodeService } from '../../node/node.service';

describe('CryptoService', () => {
  let service: CryptoService;

  let lightningService: LightningService;
  let moneroService: MoneroService;
  let arweaveService: ArweaveService;
  let nodeService: NodeService;
  let railgunService: RailgunService;
  let solanaService: SolanaService;

  beforeEach(async () => {
    lightningService = createMock<LightningService>();
    moneroService = createMock<MoneroService>();
    arweaveService = createMock<ArweaveService>();
    railgunService = createMock<RailgunService>();
    nodeService = createMock<NodeService>();
    solanaService = createMock<SolanaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: LightningService, useValue: lightningService },
        { provide: MoneroService, useValue: moneroService },
        { provide: ArweaveService, useValue: arweaveService },
        { provide: NodeService, useValue: nodeService },
        { provide: RailgunService, useValue: railgunService },
        { provide: SolanaService, useValue: solanaService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return Blockchain.BITCOIN for address bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234', () => {
    expect(CryptoService.getBlockchainsBasedOn('bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234')).toEqual([
      Blockchain.BITCOIN,
    ]);
  });

  it('should return Blockchain.BITCOIN for address 3CBMMXCFVjosAJkgdroNPNiUHHZytG1324', () => {
    expect(CryptoService.getBlockchainsBasedOn('3CBMMXCFVjosAJkgdroNPNiUHHZytG1324')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.BITCOIN for address 1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234', () => {
    expect(CryptoService.getBlockchainsBasedOn('1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.BITCOIN for address bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus', () => {
    expect(
      CryptoService.getBlockchainsBasedOn('bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus'),
    ).toEqual([Blockchain.BITCOIN]);
  });

  it('should return Blockchain.ETHEREUM and Blockchain.BINANCE_SMART_CHAIN for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(CryptoService.getBlockchainsBasedOn('0x2d84553B3A4753009A314106d58F0CC21f441234')).toEqual([
      Blockchain.ETHEREUM,
      Blockchain.BINANCE_SMART_CHAIN,
      Blockchain.ARBITRUM,
      Blockchain.OPTIMISM,
      Blockchain.POLYGON,
      Blockchain.BASE,
      Blockchain.HAQQ,
    ]);
  });

  it('should return Blockchain.DEFICHAIN for address tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234', () => {
    expect(CryptoService.getBlockchainsBasedOn('tf1qpfe7qandmtsspgwyxlzcer66ajrzgy5n7e1234')).toEqual([
      Blockchain.DEFICHAIN,
    ]);
  });

  it('should return Blockchain.LIGHTNING for address LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM',
      ),
    ).toEqual([Blockchain.LIGHTNING]);

    expect(
      CryptoService.getBlockchainsBasedOn(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5ARZETRVVENWDTRXU6RSWP5VGCRYCF5X33NWERYVY6R2EN9XFNXXDJQDP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3HXG6R4VGHK27R59UG5PY0U',
      ),
    ).toEqual([Blockchain.LIGHTNING]);

    expect(
      CryptoService.getBlockchainsBasedOn('LNNID030D98A1D3F824E316D31E74A743C852547E9D100F5B1A9AA9E23CA6A24879233B'),
    ).toEqual([Blockchain.LIGHTNING]);
  });

  it('should return Blockchain.MONERO for address 43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        '43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU',
      ),
    ).toEqual([Blockchain.MONERO]);

    expect(
      CryptoService.getBlockchainsBasedOn(
        '88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1',
      ),
    ).toEqual([Blockchain.MONERO]);
  });

  it('should return Blockchain.LIQUID for address VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy',
      ),
    ).toEqual([Blockchain.LIQUID]);
  });

  it('should return Blockchain.LIQUID for address VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67',
      ),
    ).toEqual([Blockchain.LIQUID]);
  });

  it('should return Blockchain.ARWEAVE for address RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk', () => {
    expect(CryptoService.getBlockchainsBasedOn('RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk')).toEqual([
      Blockchain.ARWEAVE,
    ]);
  });

  it('should return Blockchain.ARWEAVE for address GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk', () => {
    expect(CryptoService.getBlockchainsBasedOn('GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk')).toEqual([
      Blockchain.ARWEAVE,
    ]);
  });

  it('should return Blockchain.CARDANO for address stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy', () => {
    expect(CryptoService.getBlockchainsBasedOn('stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy')).toEqual([
      Blockchain.CARDANO,
    ]);
  });

  it('should return Blockchain.RAILGUN for address 0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        '0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh',
      ),
    ).toEqual([Blockchain.RAILGUN]);
  });
});
