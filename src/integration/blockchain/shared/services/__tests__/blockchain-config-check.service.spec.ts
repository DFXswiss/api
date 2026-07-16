import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainConfigCheckService } from 'src/integration/blockchain/shared/services/blockchain-config-check.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';

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

  function mockClients(clients: Partial<Record<Blockchain, { isConfigured: boolean }>>): void {
    jest.spyOn(blockchainRegistryService, 'getClient').mockImplementation((chain: Blockchain) => {
      const client = clients[chain];
      if (!client) throw new Error(`No service found for blockchain ${chain}`);
      return client as any;
    });
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
});
