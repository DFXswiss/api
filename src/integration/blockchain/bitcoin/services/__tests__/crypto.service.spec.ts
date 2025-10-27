import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArweaveService } from 'src/integration/blockchain/arweave/services/arweave.service';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserAddressType } from 'src/subdomains/generic/user/models/user/user.enum';
import { BitcoinService } from '../../node/bitcoin.service';

describe('CryptoService', () => {
  let service: CryptoService;

  let bitcoinService: BitcoinService;
  let lightningService: LightningService;
  let sparkService: SparkService;
  let moneroService: MoneroService;
  let zanoService: ZanoService;
  let solanaService: SolanaService;
  let tronService: TronService;
  let arweaveService: ArweaveService;
  let railgunService: RailgunService;

  beforeEach(async () => {
    bitcoinService = createMock<BitcoinService>();
    lightningService = createMock<LightningService>();
    sparkService = createMock<SparkService>();
    moneroService = createMock<MoneroService>();
    zanoService = createMock<ZanoService>();
    solanaService = createMock<SolanaService>();
    tronService = createMock<TronService>();
    arweaveService = createMock<ArweaveService>();
    railgunService = createMock<RailgunService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: BitcoinService, useValue: bitcoinService },
        { provide: LightningService, useValue: lightningService },
        { provide: SparkService, useValue: sparkService },
        { provide: MoneroService, useValue: moneroService },
        { provide: ZanoService, useValue: zanoService },
        { provide: SolanaService, useValue: solanaService },
        { provide: TronService, useValue: tronService },
        { provide: ArweaveService, useValue: arweaveService },
        { provide: RailgunService, useValue: railgunService },
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

  it('should return UserAddressType.BITCOIN_BECH32 for address bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234', () => {
    expect(CryptoService.getAddressType('bc1q4mzpjac5e53dmgnq54j58klvldhme39ed71234')).toEqual(
      UserAddressType.BITCOIN_BECH32,
    );
  });

  it('should return Blockchain.BITCOIN for address 3CBMMXCFVjosAJkgdroNPNiUHHZytG1324', () => {
    expect(CryptoService.getBlockchainsBasedOn('3CBMMXCFVjosAJkgdroNPNiUHHZytG1324')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return UserAddressType.BITCOIN_LEGACY for address 3CBMMXCFVjosAJkgdroNPNiUHHZytG1324', () => {
    expect(CryptoService.getAddressType('3CBMMXCFVjosAJkgdroNPNiUHHZytG1324')).toEqual(UserAddressType.BITCOIN_LEGACY);
  });

  it('should return Blockchain.BITCOIN for address 1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234', () => {
    expect(CryptoService.getBlockchainsBasedOn('1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234')).toEqual([Blockchain.BITCOIN]);
  });

  it('should return UserAddressType.BITCOIN_LEGACY for address 1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234', () => {
    expect(CryptoService.getAddressType('1Ka5c7Jpwxgqq9P2xRgZN5rQypzEUn1234')).toEqual(UserAddressType.BITCOIN_LEGACY);
  });

  it('should return Blockchain.BITCOIN for address bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus', () => {
    expect(
      CryptoService.getBlockchainsBasedOn('bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus'),
    ).toEqual([Blockchain.BITCOIN]);
  });

  it('should return UserAddressType.BITCOIN_BECH32 for address bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus', () => {
    expect(CryptoService.getAddressType('bc1qpzfx7v5fzkr77azkfklkc5n3al2tlt46z9zjj2xnjazncj9k9s0qmavnus')).toEqual(
      UserAddressType.BITCOIN_BECH32,
    );
  });

  it('should return Blockchain.LIGHTNING for address LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM',
      ),
    ).toEqual([Blockchain.LIGHTNING]);
  });

  it('should return UserAddressType.LN_URL for address LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM', () => {
    expect(
      CryptoService.getAddressType(
        'LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM',
      ),
    ).toEqual(UserAddressType.LN_URL);
  });

  it('should return Blockchain.LIGHTNING for address LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5ARZETRVVENWDTRXU6RSWP5VGCRYCF5X33NWERYVY6R2EN9XFNXXDJQDP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3HXG6R4VGHK27R59UG5PY0U', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5ARZETRVVENWDTRXU6RSWP5VGCRYCF5X33NWERYVY6R2EN9XFNXXDJQDP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3HXG6R4VGHK27R59UG5PY0U',
      ),
    ).toEqual([Blockchain.LIGHTNING]);
  });

  it('should return UserAddressType.LND_HUB for address LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5ARZETRVVENWDTRXU6RSWP5VGCRYCF5X33NWERYVY6R2EN9XFNXXDJQDP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3HXG6R4VGHK27R59UG5PY0U', () => {
    expect(
      CryptoService.getAddressType(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5ARZETRVVENWDTRXU6RSWP5VGCRYCF5X33NWERYVY6R2EN9XFNXXDJQDP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3HXG6R4VGHK27R59UG5PY0U',
      ),
    ).toEqual(UserAddressType.LND_HUB);
  });

  it('should return Blockchain.LIGHTNING for address LNNID030D98A1D3F824E316D31E74A743C852547E9D100F5B1A9AA9E23CA6A24879233B', () => {
    expect(
      CryptoService.getBlockchainsBasedOn('LNNID030D98A1D3F824E316D31E74A743C852547E9D100F5B1A9AA9E23CA6A24879233B'),
    ).toEqual([Blockchain.LIGHTNING]);
  });

  it('should return UserAddressType.LND_HUB for address LNNID030D98A1D3F824E316D31E74A743C852547E9D100F5B1A9AA9E23CA6A24879233B', () => {
    expect(
      CryptoService.getAddressType('LNNID030D98A1D3F824E316D31E74A743C852547E9D100F5B1A9AA9E23CA6A24879233B'),
    ).toEqual(UserAddressType.LN_NID);
  });

  it('should return Blockchain.ETHEREUM and Blockchain.BINANCE_SMART_CHAIN for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(CryptoService.getBlockchainsBasedOn('0x2d84553B3A4753009A314106d58F0CC21f441234')).toEqual([
      Blockchain.ETHEREUM,
      Blockchain.SEPOLIA,
      Blockchain.BINANCE_SMART_CHAIN,
      Blockchain.ARBITRUM,
      Blockchain.OPTIMISM,
      Blockchain.POLYGON,
      Blockchain.BASE,
      Blockchain.GNOSIS,
      Blockchain.HAQQ,
      Blockchain.CITREA_TESTNET,
    ]);
  });

  it('should return UserAddressType.EVM for address 0x2d84553B3A4753009A314106d58F0CC21f441234', () => {
    expect(CryptoService.getAddressType('0x2d84553B3A4753009A314106d58F0CC21f441234')).toEqual(UserAddressType.EVM);
  });

  it('should return Blockchain.MONERO for address 43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        '43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU',
      ),
    ).toEqual([Blockchain.MONERO]);
  });

  it('should return UserAddressType.MONERO for address 43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU', () => {
    expect(
      CryptoService.getAddressType(
        '43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU',
      ),
    ).toEqual(UserAddressType.MONERO);
  });

  it('should return Blockchain.MONERO for address 88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        '88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1',
      ),
    ).toEqual([Blockchain.MONERO]);
  });

  it('should return UserAddressType.MONERO for address 88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1', () => {
    expect(
      CryptoService.getAddressType(
        '88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1',
      ),
    ).toEqual(UserAddressType.MONERO);
  });

  it('should return Blockchain.ZANO for address ZxDGqXPCPFs8gLbE998HeZB2u9gV4V5EaMvNSHsmc3Yb6FFv8QjEhmxXq6Ddt6GeKPcDCfCEUdoTvMJXnqp651uU2KF3sHwaK', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'ZxDGqXPCPFs8gLbE998HeZB2u9gV4V5EaMvNSHsmc3Yb6FFv8QjEhmxXq6Ddt6GeKPcDCfCEUdoTvMJXnqp651uU2KF3sHwaK',
      ),
    ).toEqual([Blockchain.ZANO]);
  });

  it('should return UserAddressType.ZANO for address ZxDGqXPCPFs8gLbE998HeZB2u9gV4V5EaMvNSHsmc3Yb6FFv8QjEhmxXq6Ddt6GeKPcDCfCEUdoTvMJXnqp651uU2KF3sHwaK', () => {
    expect(
      CryptoService.getAddressType(
        'ZxDGqXPCPFs8gLbE998HeZB2u9gV4V5EaMvNSHsmc3Yb6FFv8QjEhmxXq6Ddt6GeKPcDCfCEUdoTvMJXnqp651uU2KF3sHwaK',
      ),
    ).toEqual(UserAddressType.ZANO);
  });

  it('should return Blockchain.ZANO for address iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
      ),
    ).toEqual([Blockchain.ZANO]);
  });

  it('should return UserAddressType.ZANO for address iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz', () => {
    expect(
      CryptoService.getAddressType(
        'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
      ),
    ).toEqual(UserAddressType.ZANO);
  });

  it('should return Blockchain.SOLANA for address LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3', () => {
    expect(CryptoService.getBlockchainsBasedOn('LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3')).toEqual([
      Blockchain.SOLANA,
    ]);
  });

  it('should return UserAddressType.SOLANA for address LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3', () => {
    expect(CryptoService.getAddressType('LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3')).toEqual(UserAddressType.SOLANA);
  });

  it('should return Blockchain.TRON for address TRmumx428iKqDQkBMhtjK8DQgcfYK7NdZP', () => {
    expect(CryptoService.getBlockchainsBasedOn('TRmumx428iKqDQkBMhtjK8DQgcfYK7NdZP')).toEqual([Blockchain.TRON]);
  });

  it('should return UserAddressType.TRON for address TRmumx428iKqDQkBMhtjK8DQgcfYK7NdZP', () => {
    expect(CryptoService.getAddressType('TRmumx428iKqDQkBMhtjK8DQgcfYK7NdZP')).toEqual(UserAddressType.TRON);
  });

  it('should return Blockchain.LIQUID for address VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy',
      ),
    ).toEqual([Blockchain.LIQUID]);
  });

  it('should return UserAddressType.LIQUID for address VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy', () => {
    expect(
      CryptoService.getAddressType('VTpzTic2n6uzefaDsrwtUJJYEXTdw1Q9hTk5G9XGFRM9WUhbAbjwgbZ3pr71QnuAmTFSfzPEzF7CWuBy'),
    ).toEqual(UserAddressType.LIQUID);
  });

  it('should return Blockchain.LIQUID for address VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        'VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67',
      ),
    ).toEqual([Blockchain.LIQUID]);
  });

  it('should return UserAddressType.LIQUID for address VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67', () => {
    expect(
      CryptoService.getAddressType('VJL8r24A8tovW2f1hmFsHNXPTqBU1rp77hFp7wwj6pkkEboKYUb1qqsf2ZT8P5MCsiZTsnS7Eh4y6Z67'),
    ).toEqual(UserAddressType.LIQUID);
  });

  it('should return Blockchain.ARWEAVE for address RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk', () => {
    expect(CryptoService.getBlockchainsBasedOn('RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk')).toEqual([
      Blockchain.ARWEAVE,
    ]);
  });

  it('should return UserAddressType.ARWEAVE for address RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk', () => {
    expect(CryptoService.getAddressType('RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk')).toEqual(
      UserAddressType.ARWEAVE,
    );
  });

  it('should return Blockchain.ARWEAVE for address GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk', () => {
    expect(CryptoService.getBlockchainsBasedOn('GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk')).toEqual([
      Blockchain.ARWEAVE,
    ]);
  });

  it('should return UserAddressType.ARWEAVE for address GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk', () => {
    expect(CryptoService.getAddressType('GRQ7swQO1AMyFgnuAPI7AvGQlW3lzuQuwlJbIpWV7xk')).toEqual(
      UserAddressType.ARWEAVE,
    );
  });

  it('should return Blockchain.CARDANO for address stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy', () => {
    expect(CryptoService.getBlockchainsBasedOn('stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy')).toEqual([
      Blockchain.CARDANO,
    ]);
  });

  it('should return UserAddressType.CARDANO for address stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy', () => {
    expect(CryptoService.getAddressType('stake1uxuejpadqz7gtt9r7jk3xkqnzvd4xx7yazz0wgsry6srgvc075tzy')).toEqual(
      UserAddressType.CARDANO,
    );
  });

  it('should return Blockchain.RAILGUN for address 0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh', () => {
    expect(
      CryptoService.getBlockchainsBasedOn(
        '0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh',
      ),
    ).toEqual([Blockchain.RAILGUN]);
  });

  it('should return UserAddressType.RAILGUN for address 0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh', () => {
    expect(
      CryptoService.getAddressType(
        '0zk1qyq24xdx7xuuf2ldgm2a96zd32t9ktru7dm88apaykhqu9cmnx9a3rv7j6fe3z53l7p2rhypluwfqqwa6t7nejqq0nj2quwy0599l8aw8u7fqh98qkhyupxjfqh',
      ),
    ).toEqual(UserAddressType.RAILGUN);
  });
});
