import { mock } from 'jest-mock-extended';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TatumWebhookDto } from 'src/integration/tatum/dto/tatum.dto';
import { TatumWebhookService } from 'src/integration/tatum/services/tatum-webhook.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { PayInType } from '../../../../entities/crypto-input.entity';
import { PayInMoneroService } from '../../../../services/payin-monero.service';
import { PayInZanoService } from '../../../../services/payin-zano.service';
import { MoneroStrategy } from '../monero.strategy';
import { SolanaStrategy } from '../solana.strategy';
import { ZanoStrategy } from '../zano.strategy';

// #4287 stage 3 + migration 1784600000007: setting asset.decimals for the three non-EVM native COINs (SOL=9, XMR=12,
// ZANO=12) ACTIVATES the exact base-unit capture at deposit ingestion. Each strategy scales the exact whole-unit
// on-chain decimal (amountExact / the Tatum decimal string) to PayInEntry.amountBaseUnits via
// fromDecimalString(value, asset.decimals). With decimals NULL that returns undefined (fail-open, the pre-migration
// state); with the native scale set it recovers the 9th–12th decimal that the ledger's 8-dp float derivation drops.
// The strategies' private mapping methods are exercised directly (getTxType stubbed) so only the mapping + capture is
// under test — mirrors bitcoin.strategy.spec. The float `amount` must stay untouched (it is computed from each chain's
// own fixed scale, never asset.decimals).
describe('native-coin exact base-unit capture activated by asset.decimals (#4287 stage 3)', () => {
  describe('Solana SOL (decimals 9 — lamports)', () => {
    function makeStrategy(): SolanaStrategy {
      const strategy = new SolanaStrategy(
        mock<TatumWebhookService>(),
        mock<SolanaService>(),
        mock<RepositoryFactory>(),
      );
      jest.spyOn(strategy as any, 'getTxType').mockReturnValue(PayInType.DEPOSIT);
      return strategy;
    }

    const dto = {
      type: 'native',
      amount: '1.123456789', // 9-dp — the 9th decimal is beyond the ledger's 8-dp float derivation
      address: 'ADDR',
      counterAddresses: ['SENDER'],
      txId: 'TX',
      blockNumber: 1,
    } as TatumWebhookDto;

    it('captures the exact 9-dp lamports when SOL coin decimals = 9', () => {
      const sol = createCustomAsset({ name: 'SOL', blockchain: Blockchain.SOLANA, type: AssetType.COIN, decimals: 9 });
      const entry = (makeStrategy() as any).mapSolanaTransaction(dto, [sol]);
      expect(entry.amountBaseUnits).toBe('1123456789'); // 1.123456789 SOL = 1'123'456'789 lamports (9th dp kept)
      expect(entry.amount).toBe(1.123456789); // float amount untouched
    });

    it('fails open (undefined) with unset decimals — the pre-migration state', () => {
      const sol = createCustomAsset({ name: 'SOL', blockchain: Blockchain.SOLANA, type: AssetType.COIN });
      const entry = (makeStrategy() as any).mapSolanaTransaction(dto, [sol]);
      expect(entry.amountBaseUnits).toBeUndefined();
    });
  });

  describe('Monero XMR (decimals 12 — piconero)', () => {
    function makeStrategy(decimals?: number): MoneroStrategy {
      const strategy = new MoneroStrategy(mock<PayInMoneroService>());
      (strategy as any).assetService = {
        getMoneroCoin: jest
          .fn()
          .mockResolvedValue(
            createCustomAsset({ name: 'XMR', blockchain: Blockchain.MONERO, type: AssetType.COIN, decimals }),
          ),
      };
      jest.spyOn(strategy as any, 'getTxType').mockReturnValue(PayInType.DEPOSIT);
      return strategy;
    }

    const transfer = {
      amount: 1.123456789012,
      fee: 0,
      txid: 'TX',
      amountExact: '1.123456789012', // 12-dp — the 9th–12th decimals are beyond the 8-dp float derivation
      height: 1,
      address: 'ADDR',
    } as MoneroTransferDto;

    it('captures the exact 12-dp piconero when XMR coin decimals = 12', async () => {
      const entries = await (makeStrategy(12) as any).mapToPayInEntries([transfer]);
      expect(entries[0].amountBaseUnits).toBe('1123456789012'); // 1.123456789012 XMR = 1'123'456'789'012 piconero
      expect(entries[0].amount).toBe(1.123456789012); // float amount untouched
    });

    it('fails open (undefined) with unset decimals — the pre-migration state', async () => {
      const entries = await (makeStrategy(undefined) as any).mapToPayInEntries([transfer]);
      expect(entries[0].amountBaseUnits).toBeUndefined();
    });
  });

  describe('Zano ZANO (decimals 12 — atomic units)', () => {
    function makeStrategy(): ZanoStrategy {
      const strategy = new ZanoStrategy(mock<PayInZanoService>());
      jest.spyOn(strategy as any, 'getTxType').mockReturnValue(PayInType.DEPOSIT);
      return strategy;
    }

    const CHAIN_ID = 'ZANO_ASSET_ID';
    const depositAddress = BlockchainAddress.create('ADDR', Blockchain.ZANO);
    const transfer = {
      block: 1,
      txId: 'TX',
      txType: 0,
      fee: 0,
      timestamp: 0,
      receive: [{ amount: 1.123456789012, assetId: CHAIN_ID, amountExact: '1.123456789012' }],
    } as ZanoTransferDto;

    it('captures the exact 12-dp atomic units when ZANO coin decimals = 12', () => {
      const zano = createCustomAsset({
        name: 'ZANO',
        blockchain: Blockchain.ZANO,
        type: AssetType.COIN,
        decimals: 12,
        chainId: CHAIN_ID,
      });
      const entries = (makeStrategy() as any).doMapToPayInEntries(depositAddress, transfer, [zano]);
      expect(entries[0].amountBaseUnits).toBe('1123456789012'); // 1.123456789012 ZANO = 1'123'456'789'012 atomic
      expect(entries[0].amount).toBe(1.123456789012); // float amount untouched
    });

    it('fails open (undefined) with unset decimals — the pre-migration state', () => {
      const zano = createCustomAsset({
        name: 'ZANO',
        blockchain: Blockchain.ZANO,
        type: AssetType.COIN,
        chainId: CHAIN_ID,
      });
      const entries = (makeStrategy() as any).doMapToPayInEntries(depositAddress, transfer, [zano]);
      expect(entries[0].amountBaseUnits).toBeUndefined();
    });
  });
});
