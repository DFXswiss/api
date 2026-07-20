import { mock } from 'jest-mock-extended';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayInType } from '../../../../entities/crypto-input.entity';
import { PayInBitcoinService } from '../../../../services/payin-bitcoin.service';
import { BitcoinStrategy } from '../bitcoin.strategy';

// #4287 stage 1: the register BitcoinStrategy captures the exact satoshi of a UTXO into PayInEntry.amountBaseUnits.
// The capture is exact only for a ≤8-dp, ≤~21M-supply asset (BTC today); the ≤8-dp guard degrades anything else to the
// derived path (undefined) rather than a silent off-by-a-base-unit value. mapUtxosToEntries is exercised directly with
// getPayInAddresses / getTxType / getBtcCoin stubbed so only the mapping + guard are under test.
describe('BitcoinStrategy register — exact-satoshi capture guard (#4287 stage 1)', () => {
  function makeStrategy(decimals: number | null): BitcoinStrategy {
    const strategy = new BitcoinStrategy(mock<PayInBitcoinService>());
    (strategy as any).assetService = {
      getBtcCoin: jest.fn().mockResolvedValue(createCustomAsset({ decimals: decimals as any })),
    };
    jest.spyOn(strategy as any, 'getPayInAddresses').mockResolvedValue(['ADDR']);
    jest.spyOn(strategy as any, 'getTxType').mockReturnValue(PayInType.DEPOSIT);
    return strategy;
  }

  const utxo = {
    txid: 'TX',
    vout: 0,
    address: 'ADDR',
    amount: 0.12345678, // 8-dp BTC amount, exact in a double
    prevoutAddresses: ['SENDER'],
    confirmations: 1,
  } as any;

  it('captures exact satoshi for BTC (8 dp) — path unchanged', async () => {
    const entries = await (makeStrategy(8) as any).mapUtxosToEntries([utxo]);
    expect(entries[0].amountBaseUnits).toBe('12345678'); // 0.12345678 BTC = 12,345,678 sat
    expect(entries[0].amount).toBe(0.12345678); // float amount untouched
  });

  it('fails open (undefined) for a >8-dp UTXO asset — never a silent off-by-a-base-unit capture', async () => {
    const entries = await (makeStrategy(12) as any).mapUtxosToEntries([utxo]);
    expect(entries[0].amountBaseUnits).toBeUndefined();
  });

  it('fails open (undefined) when the asset decimals are unknown', async () => {
    const entries = await (makeStrategy(null) as any).mapUtxosToEntries([utxo]);
    expect(entries[0].amountBaseUnits).toBeUndefined();
  });
});
