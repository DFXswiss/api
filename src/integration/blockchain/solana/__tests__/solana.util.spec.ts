import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { SolanaUtil } from '../solana.util';

describe('SolanaUtil', () => {
  // #4287 stage 3: the broadcast-resolution base-unit capture used by the Solana withdrawal exact path.
  describe('toBroadcastBaseUnits (#4287 stage 3)', () => {
    it('captures a native coin at the lamports (9-dp) scale, keeping the 9th dp the 8-dp float would lose', () => {
      const coin = createCustomAsset({ type: AssetType.COIN, decimals: 9 });
      expect(SolanaUtil.toBroadcastBaseUnits(1.123456789, coin)).toBe(1123456789n);
    });

    it('captures a token at its configured decimals', () => {
      const token = createCustomAsset({ type: AssetType.TOKEN, decimals: 6 }); // e.g. USDC-SPL
      expect(SolanaUtil.toBroadcastBaseUnits(2.123456, token)).toBe(2123456n);
    });

    it('fails open (null) for a coin whose configured decimals !== 9 (broadcast is lamports/9)', () => {
      const coin = createCustomAsset({ type: AssetType.COIN, decimals: 8 });
      expect(SolanaUtil.toBroadcastBaseUnits(1, coin)).toBeNull();
    });

    it('fails open (null) for unknown decimals or a missing asset', () => {
      expect(
        SolanaUtil.toBroadcastBaseUnits(1, createCustomAsset({ type: AssetType.TOKEN, decimals: undefined })),
      ).toBeNull();
      expect(SolanaUtil.toBroadcastBaseUnits(1, null)).toBeNull();
      expect(SolanaUtil.toBroadcastBaseUnits(1, undefined)).toBeNull();
    });
  });
});
