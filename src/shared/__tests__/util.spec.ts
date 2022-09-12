import { Configuration } from 'src/config/config';
import { Util } from '../util';

describe('Util', () => {
  it('should transform configs min deposit to a min deposit array', () => {
    const config = new Configuration();
    expect(Util.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain)).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
      { amount: 1, asset: 'USD' },
    ]);
  });

  it('should transform configs min deposit to a min deposit array and filter for DFI', () => {
    const config = new Configuration();
    expect(Util.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain, 'DFI')).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
    ]);
  });

  it('should transform configs min deposit to a min deposit array and filter for DFI and USD', () => {
    const config = new Configuration();
    expect(Util.transformToMinDeposit(config.blockchain.default.minDeposit.DeFiChain, ['DFI', 'USD'])).toStrictEqual([
      { amount: 0.01, asset: 'DFI' },
      { amount: 1, asset: 'USD' },
    ]);
  });
});
