describe.skip('DEX Module Integration Tests', () => {
  describe('Check Liquidity', () => {
    it('checks BNB coin availability', () => {
      // TODO
    });

    it('checks ETH coin availability', () => {
      // TODO
    });

    it('checks DeFiChain Pool Pair availability', () => {
      // TODO
    });

    it('checks DeFiChain non Pool Pair availability', () => {
      // TODO
    });

    it('checks Bitcoin BTC availability', () => {
      // TODO
    });

    describe('Failure scenarios', () => {
      it('', () => {
        // TODO
      });
    });
  });

  describe('Reserve Liquidity', () => {
    describe('Any asset', () => {
      it('Creates reservation order for any available asset', () => {
        // TODO
      });
    });

    describe('Failure scenarios', () => {
      it('refuse to make reservation if not enough liquidity', () => {
        // TODO
      });

      it('refuse to make reservation if there is a price slippage', () => {
        // TODO
      });
    });
  });

  describe('Purchase Liquidity', () => {
    it('purchase BNB native coin', () => {
      // TODO
    });

    it('purchase ETH native coin', () => {
      // TODO
    });

    it('purchase DeFiChain Crypto', () => {
      // TODO
    });

    it('purchase DeFiChain Pool Pair', () => {
      // TODO
    });

    it('purchase DeFiChain Stock', () => {
      // TODO
    });

    it('purchase DeFiChain non Pool Pair', () => {
      // TODO
    });

    describe('Failure scenarios', () => {
      it('', () => {
        // TODO
      });
    });
  });
});
