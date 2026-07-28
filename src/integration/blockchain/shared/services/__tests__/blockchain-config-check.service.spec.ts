import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Environment } from 'src/config/config';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainConfigCheckService } from 'src/integration/blockchain/shared/services/blockchain-config-check.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';

// TestBlockchains is evaluated from process.env at import time and is empty outside prd, so the module is
// loaded under a prd environment to get the real prd list instead of a copy that could drift from it
jest.mock('src/integration/blockchain/shared/util/blockchain.util', () => {
  const environment = process.env.ENVIRONMENT;
  process.env.ENVIRONMENT = 'prd';

  try {
    return jest.requireActual('src/integration/blockchain/shared/util/blockchain.util');
  } finally {
    process.env.ENVIRONMENT = environment;
  }
});

type MockClient = { isConfigured: boolean } | null;

describe('BlockchainConfigCheckService', () => {
  let service: BlockchainConfigCheckService;
  let blockchainRegistryService: BlockchainRegistryService;

  async function setup(environment: Environment): Promise<void> {
    blockchainRegistryService = createMock<BlockchainRegistryService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainConfigCheckService,
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        TestUtil.provideConfig({ environment }),
      ],
    }).compile();

    service = module.get<BlockchainConfigCheckService>(BlockchainConfigCheckService);
  }

  function mockClients(
    clients: Partial<Record<Blockchain, MockClient>>,
    bitcoinNodes: Partial<Record<BitcoinNodeType, MockClient>> = {
      [BitcoinNodeType.BTC_INPUT]: { isConfigured: true },
      [BitcoinNodeType.BTC_OUTPUT]: { isConfigured: true },
    },
  ): void {
    // missing key = no registered service for that chain, null = registered service without a client
    jest.spyOn(blockchainRegistryService, 'getClient').mockImplementation((chain: Blockchain) => {
      if (!(chain in clients)) throw new Error(`No service found for blockchain ${chain}`);
      return clients[chain] as any;
    });
    jest
      .spyOn(blockchainRegistryService, 'getBitcoinClient')
      .mockImplementation((_: Blockchain, type: BitcoinNodeType) => bitcoinNodes[type] as any);
  }

  afterEach(() => jest.restoreAllMocks());

  it('warns with the unconfigured chains on every tick', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({
      [Blockchain.ETHEREUM]: { isConfigured: true },
      [Blockchain.CARDANO]: { isConfigured: false },
      [Blockchain.SOLANA]: { isConfigured: false },
    });

    service.logUnconfiguredClients();
    service.logUnconfiguredClients();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('Blockchain client not configured: Cardano, Solana');
  });

  it('stays silent when all clients are configured', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({
      [Blockchain.ETHEREUM]: { isConfigured: true },
      [Blockchain.CARDANO]: { isConfigured: true },
      [Blockchain.SOLANA]: { isConfigured: true },
    });

    service.logUnconfiguredClients();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent outside prd, where unconfigured clients are intended', async () => {
    await setup(Environment.DEV);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({ [Blockchain.CARDANO]: { isConfigured: false } });

    service.logUnconfiguredClients();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(blockchainRegistryService.getClient).not.toHaveBeenCalled();
  });

  it('warns when getClient returns null for a chain with a registered service', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({ [Blockchain.FIRO]: null });

    service.logUnconfiguredClients();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Blockchain client not configured: Firo');
  });

  it('reports the bitcoin output node, which the default client lookup skips', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({}, { [BitcoinNodeType.BTC_INPUT]: { isConfigured: true }, [BitcoinNodeType.BTC_OUTPUT]: null });

    service.logUnconfiguredClients();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Blockchain client not configured: Bitcoin (btc-out)');
  });

  it('ignores test blockchains, which have no prd config by design', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({ [Blockchain.BITCOIN_TESTNET4]: null, [Blockchain.SEPOLIA]: { isConfigured: false } });

    service.logUnconfiguredClients();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports a chain whose check fails unexpectedly instead of aborting the sweep', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(blockchainRegistryService, 'getClient').mockImplementation((chain: Blockchain) => {
      if (chain === Blockchain.MONERO) throw new Error('Monero node not configured');
      throw new Error(`No service found for blockchain ${chain}`);
    });
    jest.spyOn(blockchainRegistryService, 'getBitcoinClient').mockReturnValue({ isConfigured: true } as any);

    service.logUnconfiguredClients();

    expect(warnSpy).toHaveBeenCalledWith('Blockchain client not configured: Monero');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  // the sweep tells "no service registered" apart from a real failure by the message the registry throws
  it('skips exactly the chains for which the registry reports no service', () => {
    const getService = BlockchainRegistryService.prototype.getService;

    expect(() => getService.call({}, Blockchain.LIGHTNING)).toThrow('No service found for blockchain Lightning');
  });
});
