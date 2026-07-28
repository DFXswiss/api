import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Environment } from 'src/config/config';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainConfigCheckService } from 'src/integration/blockchain/shared/services/blockchain-config-check.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';

// TestBlockchains is evaluated from process.env at import time and is empty outside prd, so the prd list is
// pinned here to exercise the behavior the (prd-only) sweep actually has in production
jest.mock('src/integration/blockchain/shared/util/blockchain.util', () => {
  const util = jest.requireActual('src/integration/blockchain/shared/util/blockchain.util');
  const { Blockchain: Chain } = jest.requireActual('src/integration/blockchain/shared/enums/blockchain.enum');

  return {
    ...util,
    TestBlockchains: [Chain.SEPOLIA, Chain.CITREA_TESTNET, Chain.BITCOIN_TESTNET4, Chain.HAQQ, Chain.ARWEAVE],
  };
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
    expect(warnSpy).toHaveBeenCalledWith('Blockchain clients not configured: Cardano, Solana');
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
    expect(warnSpy).toHaveBeenCalledWith('Blockchain clients not configured: Firo');
  });

  it('reports the bitcoin output node, which the default client lookup skips', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({}, { [BitcoinNodeType.BTC_INPUT]: { isConfigured: true }, [BitcoinNodeType.BTC_OUTPUT]: null });

    service.logUnconfiguredClients();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Blockchain clients not configured: Bitcoin (btc-out)');
  });

  it('ignores test blockchains, which have no prd config by design', async () => {
    await setup(Environment.PRD);
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
    mockClients({ [Blockchain.BITCOIN_TESTNET4]: null, [Blockchain.SEPOLIA]: { isConfigured: false } });

    service.logUnconfiguredClients();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
