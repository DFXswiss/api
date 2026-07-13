/**
 * Each PayoutXxxService is a thin, chain-specific binding over the shared PayoutEvmService: its
 * constructor wires the chain's EvmService#getDefaultClient() into the inherited send/gas/nonce/expiry
 * logic (already fully covered behaviourally by payout-evm.service.spec.ts). PayoutBaseService,
 * PayoutGnosisService and PayoutOptimismService additionally keep their own concretely-typed client
 * reference and override the two gas getters - this suite covers exactly those two extra branches.
 *
 * Two shared, table-driven suites (real per-chain call sites, not a silent loop - mirrors the
 * runDesignateBeforeBroadcastSuite pattern in payout-designate-before-broadcast.strategy.spec.ts)
 * cover all nine chain services: the six "plain" ones that only inherit PayoutEvmService's gas
 * getters, and the three "override" ones that shadow them with their own client.
 */

import { mock } from 'jest-mock-extended';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { BaseClient } from 'src/integration/blockchain/base/base-client';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { BscService } from 'src/integration/blockchain/bsc/bsc.service';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { GnosisClient } from 'src/integration/blockchain/gnosis/gnosis-client';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { OptimismClient } from 'src/integration/blockchain/optimism/optimism-client';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutArbitrumService } from '../payout-arbitrum.service';
import { PayoutBaseService } from '../payout-base.service';
import { PayoutBscService } from '../payout-bsc.service';
import { PayoutCitreaService } from '../payout-citrea.service';
import { PayoutEthereumService } from '../payout-ethereum.service';
import { PayoutEvmService } from '../payout-evm.service';
import { PayoutGnosisService } from '../payout-gnosis.service';
import { PayoutOptimismService } from '../payout-optimism.service';
import { PayoutPolygonService } from '../payout-polygon.service';
import { PayoutSepoliaService } from '../payout-sepolia.service';

interface PlainEvmChainVariant {
  name: string;
  createUnderlying: () => any;
  createPayoutService: (underlying: any) => PayoutEvmService;
}

function runPlainEvmChainServiceSuite(variant: PlainEvmChainVariant): void {
  describe(variant.name, () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('wires the chain EvmService default client into the constructor, feeding the inherited gas getter', async () => {
      const underlying = variant.createUnderlying();
      const client = mock<EvmClient>();
      jest.spyOn(underlying, 'getDefaultClient').mockReturnValue(client as any);
      jest.spyOn(client, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(999);

      const service = variant.createPayoutService(underlying);

      expect(underlying.getDefaultClient).toHaveBeenCalledTimes(1);
      await expect(service.getCurrentGasForCoinTransaction()).resolves.toBe(999);
      expect(client.getCurrentGasCostForCoinTransaction).toHaveBeenCalledTimes(1);
    });
  });
}

runPlainEvmChainServiceSuite({
  name: 'PayoutArbitrumService',
  createUnderlying: () => mock<ArbitrumService>(),
  createPayoutService: (underlying) => new PayoutArbitrumService(underlying),
});

runPlainEvmChainServiceSuite({
  name: 'PayoutBscService',
  createUnderlying: () => mock<BscService>(),
  createPayoutService: (underlying) => new PayoutBscService(underlying),
});

runPlainEvmChainServiceSuite({
  name: 'PayoutCitreaService',
  createUnderlying: () => mock<CitreaService>(),
  createPayoutService: (underlying) => new PayoutCitreaService(underlying),
});

runPlainEvmChainServiceSuite({
  name: 'PayoutEthereumService',
  createUnderlying: () => mock<EthereumService>(),
  createPayoutService: (underlying) => new PayoutEthereumService(underlying),
});

runPlainEvmChainServiceSuite({
  name: 'PayoutPolygonService',
  createUnderlying: () => mock<PolygonService>(),
  createPayoutService: (underlying) => new PayoutPolygonService(underlying),
});

runPlainEvmChainServiceSuite({
  name: 'PayoutSepoliaService',
  createUnderlying: () => mock<SepoliaService>(),
  createPayoutService: (underlying) => new PayoutSepoliaService(underlying),
});

interface OverrideEvmChainVariant {
  name: string;
  createUnderlying: () => any;
  createClient: () => any;
  createPayoutService: (underlying: any) => PayoutBaseService | PayoutGnosisService | PayoutOptimismService;
}

function runOverrideEvmChainServiceSuite(variant: OverrideEvmChainVariant): void {
  describe(variant.name, () => {
    let underlying: any;
    let client: any;
    let service: PayoutBaseService | PayoutGnosisService | PayoutOptimismService;

    beforeEach(() => {
      underlying = variant.createUnderlying();
      client = variant.createClient();
      jest.spyOn(underlying, 'getDefaultClient').mockReturnValue(client);

      service = variant.createPayoutService(underlying);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('wires the chain EvmService default client into the constructor', () => {
      expect(underlying.getDefaultClient).toHaveBeenCalled();
    });

    it('getCurrentGasForCoinTransaction(...) delegates to the client', async () => {
      jest.spyOn(client, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(333);

      await expect(service.getCurrentGasForCoinTransaction()).resolves.toBe(333);
      expect(client.getCurrentGasCostForCoinTransaction).toHaveBeenCalledTimes(1);
    });

    it('getCurrentGasForTokenTransaction(...) delegates to the client, forwarding the token', async () => {
      const token = createDefaultAsset();
      jest.spyOn(client, 'getCurrentGasCostForTokenTransaction').mockResolvedValue(444);

      await expect(service.getCurrentGasForTokenTransaction(token)).resolves.toBe(444);
      expect(client.getCurrentGasCostForTokenTransaction).toHaveBeenCalledWith(token);
    });
  });
}

runOverrideEvmChainServiceSuite({
  name: 'PayoutBaseService',
  createUnderlying: () => mock<BaseService>(),
  createClient: () => mock<BaseClient>(),
  createPayoutService: (underlying) => new PayoutBaseService(underlying),
});

runOverrideEvmChainServiceSuite({
  name: 'PayoutGnosisService',
  createUnderlying: () => mock<GnosisService>(),
  createClient: () => mock<GnosisClient>(),
  createPayoutService: (underlying) => new PayoutGnosisService(underlying),
});

runOverrideEvmChainServiceSuite({
  name: 'PayoutOptimismService',
  createUnderlying: () => mock<OptimismService>(),
  createClient: () => mock<OptimismClient>(),
  createPayoutService: (underlying) => new PayoutOptimismService(underlying),
});
