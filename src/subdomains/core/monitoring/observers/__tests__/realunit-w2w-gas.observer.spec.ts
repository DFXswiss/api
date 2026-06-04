import { Test, TestingModule } from '@nestjs/testing';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MonitoringService } from '../../monitoring.service';
import { RealUnitW2wGasObserver } from '../realunit-w2w-gas.observer';

// Mutable so individual tests can exercise the address-unset branch and the mainnet (Ethereum) client
// branch. jest.mock factories may only close over variables prefixed with `mock`.
let mockEnvironment = 'loc';
let mockW2wGasWalletAddress: string | undefined = '0xW2wGasWalletAddress';

jest.mock('src/config/config', () => {
  const blockchain = {
    realunit: {
      get w2wGasWalletAddress() {
        return mockW2wGasWalletAddress;
      },
      w2wGasLowBalanceThreshold: 0.05,
    },
    ethereum: { ethChainId: 1 },
    sepolia: { sepoliaChainId: 11155111 },
    arbitrum: { arbitrumChainId: 42161 },
    optimism: { optimismChainId: 10 },
    polygon: { polygonChainId: 137 },
    base: { baseChainId: 8453 },
    gnosis: { gnosisChainId: 100 },
    bsc: { bscChainId: 56 },
    citrea: { citreaChainId: 4114 },
    citreaTestnet: { citreaTestnetChainId: 5115 },
  };
  return {
    get Config() {
      return { environment: mockEnvironment, blockchain };
    },
    Environment: { LOC: 'loc', DEV: 'dev', PRD: 'prd' },
    GetConfig: jest.fn(() => ({
      blockchain,
      payment: { fee: 0.01, defaultPaymentTimeout: 900 },
      formats: {
        address: /.*/,
        signature: /.*/,
        key: /.*/,
        ref: /.*/,
        bankUsage: /.*/,
        recommendationCode: /.*/,
        kycHash: /.*/,
        phone: /.*/,
        accountServiceRef: /.*/,
        number: /.*/,
        transactionUid: /.*/,
      },
    })),
  };
});

jest.mock('src/shared/services/dfx-logger', () => ({
  DfxLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('RealUnitW2wGasObserver', () => {
  let observer: RealUnitW2wGasObserver;
  let sepoliaClient: { getNativeCoinBalanceForAddress: jest.Mock };
  let ethereumClient: { getNativeCoinBalanceForAddress: jest.Mock };
  let notificationService: jest.Mocked<NotificationService>;

  beforeEach(async () => {
    mockEnvironment = 'loc';
    mockW2wGasWalletAddress = '0xW2wGasWalletAddress';
    sepoliaClient = { getNativeCoinBalanceForAddress: jest.fn() };
    ethereumClient = { getNativeCoinBalanceForAddress: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealUnitW2wGasObserver,
        { provide: MonitoringService, useValue: { register: jest.fn() } },
        { provide: EthereumService, useValue: { getDefaultClient: jest.fn().mockReturnValue(ethereumClient) } },
        { provide: SepoliaService, useValue: { getDefaultClient: jest.fn().mockReturnValue(sepoliaClient) } },
        { provide: NotificationService, useValue: { sendMail: jest.fn() } },
      ],
    }).compile();

    observer = module.get(RealUnitW2wGasObserver);
    notificationService = module.get(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('raises a low-balance alert when balance is below the threshold', async () => {
    sepoliaClient.getNativeCoinBalanceForAddress.mockResolvedValue(0.001);

    const data = await observer.fetch();

    expect(data.lowBalance).toBe(true);
    expect(notificationService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: MailType.ERROR_MONITORING }),
    );
  });

  it('does NOT alert when balance is above the threshold', async () => {
    sepoliaClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);

    const data = await observer.fetch();

    expect(data.lowBalance).toBe(false);
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('reports no low balance and skips the balance lookup when the gas wallet address is unset', async () => {
    mockW2wGasWalletAddress = undefined;

    const data = await observer.fetch();

    expect(data.address).toBeUndefined();
    expect(data.balance).toBeUndefined();
    expect(data.lowBalance).toBe(false);
    expect(sepoliaClient.getNativeCoinBalanceForAddress).not.toHaveBeenCalled();
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('uses the Ethereum client on mainnet (PRD) environment', async () => {
    mockEnvironment = 'prd';
    ethereumClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);

    const data = await observer.fetch();

    expect(ethereumClient.getNativeCoinBalanceForAddress).toHaveBeenCalledWith('0xW2wGasWalletAddress');
    expect(sepoliaClient.getNativeCoinBalanceForAddress).not.toHaveBeenCalled();
    expect(data.lowBalance).toBe(false);
  });
});
