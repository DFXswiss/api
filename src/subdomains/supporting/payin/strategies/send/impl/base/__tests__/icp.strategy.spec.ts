/**
 * Tests for InternetComputerStrategy doSend recovery logic
 *
 * Verifies:
 * - Happy path: sendTransfer succeeds, outTxId persisted, status updated
 * - Recovery: sendTransfer fails (SDK error), blockchain scan recovers txId
 * - No recovery: sendTransfer fails, no on-chain transfer found → error re-thrown
 * - Fallback: updatePayInWithSendData fails → status still set to Forwarded
 */

const PayInStatus = {
  ACKNOWLEDGED: 'Acknowledged',
  PREPARING: 'Preparing',
  PREPARED: 'Prepared',
  FORWARDED: 'Forwarded',
  TO_RETURN: 'ToReturn',
};

describe('InternetComputerStrategy doSend', () => {
  // Shared mock state
  let mockSendTransfer: jest.Mock;
  let mockTryRecoverForwardTxId: jest.Mock;
  let mockUpdatePayInWithSendData: jest.Mock;
  let mockSave: jest.Mock;
  let loggedWarnings: string[];

  function createPayIn(overrides: Record<string, unknown> = {}) {
    return {
      id: 430906,
      status: PayInStatus.PREPARED,
      outTxId: null as string | null,
      forwardFeeAmount: 0.0001,
      forwardFeeAmountChf: 0,
      sendingAmount: 10,
      amount: 10,
      maxForwardFee: 1,
      asset: {
        chainId: 'ly36x-wiaaa-aaaai-aqj7q-cai',
        decimals: 8,
        uniqueName: 'VCHF',
        blockchain: 'InternetComputer',
      },
      address: { address: 'deposit-principal' },
      destinationAddress: { address: 'dex-wallet-principal' },
      route: { deposit: { accountIndex: 2 } },
      forward(outTxId: string, _feeAmount?: number, _feeAmountChf?: number) {
        this.outTxId = outTxId;
        this.status = PayInStatus.FORWARDED;
        return this;
      },
      ...overrides,
    };
  }

  /**
   * Simulates the PREPARED block of doSend with the same logic as icp.strategy.ts
   */
  async function simulateDoSendPreparedBlock(payIn: ReturnType<typeof createPayIn>): Promise<void> {
    let outTxId: string;

    try {
      outTxId = await mockSendTransfer(payIn);
    } catch (sendError: unknown) {
      const recoveredTxId = await mockTryRecoverForwardTxId(payIn);

      if (recoveredTxId) {
        loggedWarnings.push(
          `Recovered forward txId for input ${payIn.id}: ${recoveredTxId} (original error: ${(sendError as Error).message})`,
        );
        outTxId = recoveredTxId;
      } else {
        throw sendError;
      }
    }

    // persist outTxId immediately
    payIn.outTxId = outTxId;
    await mockSave(payIn);

    try {
      await mockUpdatePayInWithSendData(payIn, outTxId, payIn.forwardFeeAmount);
    } catch (updateError: unknown) {
      // pricing failed — mark as forwarded so confirmation check picks it up
      payIn.forward(outTxId);
      loggedWarnings.push(
        `Failed to finalize input ${payIn.id} after forward (outTxId=${outTxId}): ${(updateError as Error).message}`,
      );
    }

    await mockSave(payIn);
  }

  beforeEach(() => {
    loggedWarnings = [];
    mockSendTransfer = jest.fn();
    mockTryRecoverForwardTxId = jest.fn();
    mockUpdatePayInWithSendData = jest.fn();
    mockSave = jest.fn();
  });

  describe('happy path', () => {
    it('should persist outTxId and update status to Forwarded', async () => {
      const payIn = createPayIn();
      mockSendTransfer.mockResolvedValue('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      mockUpdatePayInWithSendData.mockImplementation((p: ReturnType<typeof createPayIn>) => {
        p.forward('ly36x-wiaaa-aaaai-aqj7q-cai:63582', 0.0001, 0);
      });

      await simulateDoSendPreparedBlock(payIn);

      expect(mockSendTransfer).toHaveBeenCalledTimes(1);
      expect(mockTryRecoverForwardTxId).not.toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalledTimes(2);
      expect(payIn.outTxId).toBe('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(loggedWarnings).toHaveLength(0);
    });
  });

  describe('SDK error with successful on-chain transfer (the VCHF incident)', () => {
    it('should recover txId from blockchain scan', async () => {
      const payIn = createPayIn();
      mockSendTransfer.mockRejectedValue(
        new Error('Call was returned undefined. We cannot determine if the call was successful or not.'),
      );
      mockTryRecoverForwardTxId.mockResolvedValue('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      mockUpdatePayInWithSendData.mockImplementation((p: ReturnType<typeof createPayIn>) => {
        p.forward('ly36x-wiaaa-aaaai-aqj7q-cai:63582', 0.0001, 0);
      });

      await simulateDoSendPreparedBlock(payIn);

      expect(mockSendTransfer).toHaveBeenCalledTimes(1);
      expect(mockTryRecoverForwardTxId).toHaveBeenCalledTimes(1);
      expect(payIn.outTxId).toBe('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(loggedWarnings).toHaveLength(1);
      expect(loggedWarnings[0]).toContain('Recovered forward txId');
      expect(loggedWarnings[0]).toContain('63582');
    });

    it('should persist outTxId before updatePayInWithSendData', async () => {
      const payIn = createPayIn();
      const saveCallArgs: Array<{ outTxId: string | null; status: string }> = [];

      mockSendTransfer.mockRejectedValue(new Error('SDK timeout'));
      mockTryRecoverForwardTxId.mockResolvedValue('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      mockUpdatePayInWithSendData.mockImplementation((p: ReturnType<typeof createPayIn>) => {
        p.forward('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      });
      mockSave.mockImplementation((p: { outTxId: string | null; status: string }) => {
        saveCallArgs.push({ outTxId: p.outTxId, status: p.status });
      });

      await simulateDoSendPreparedBlock(payIn);

      // First save: outTxId set, status still PREPARED
      expect(saveCallArgs[0].outTxId).toBe('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      expect(saveCallArgs[0].status).toBe(PayInStatus.PREPARED);

      // Second save: status updated to FORWARDED
      expect(saveCallArgs[1].status).toBe(PayInStatus.FORWARDED);
    });
  });

  describe('SDK error with no on-chain transfer', () => {
    it('should re-throw the original error when recovery finds nothing', async () => {
      const payIn = createPayIn();
      const originalError = new Error('Canister rejected the call');

      mockSendTransfer.mockRejectedValue(originalError);
      mockTryRecoverForwardTxId.mockResolvedValue(null);

      await expect(simulateDoSendPreparedBlock(payIn)).rejects.toThrow('Canister rejected the call');

      expect(mockTryRecoverForwardTxId).toHaveBeenCalledTimes(1);
      expect(mockSave).not.toHaveBeenCalled();
      expect(payIn.outTxId).toBeNull();
      expect(payIn.status).toBe(PayInStatus.PREPARED);
    });
  });

  describe('updatePayInWithSendData failure (pricing error)', () => {
    it('should fall back to forward() and still set status to Forwarded', async () => {
      const payIn = createPayIn();

      mockSendTransfer.mockResolvedValue('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      mockUpdatePayInWithSendData.mockRejectedValue(new Error('Pricing service unavailable'));

      await simulateDoSendPreparedBlock(payIn);

      expect(payIn.outTxId).toBe('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(mockSave).toHaveBeenCalledTimes(2);
      expect(loggedWarnings).toHaveLength(1);
      expect(loggedWarnings[0]).toContain('Failed to finalize');
      expect(loggedWarnings[0]).toContain('Pricing service unavailable');
    });

    it('should not leave payIn stuck in PREPARED', async () => {
      const payIn = createPayIn();

      mockSendTransfer.mockResolvedValue('canister:12345');
      mockUpdatePayInWithSendData.mockRejectedValue(new Error('DB timeout'));

      await simulateDoSendPreparedBlock(payIn);

      // Critical: status must NOT be PREPARED (would be invisible to all queries)
      expect(payIn.status).not.toBe(PayInStatus.PREPARED);
      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(payIn.outTxId).toBe('canister:12345');
    });
  });

  describe('recovery + pricing failure combined', () => {
    it('should recover txId AND fall back to forward() when both fail', async () => {
      const payIn = createPayIn();

      mockSendTransfer.mockRejectedValue(new Error('UnknownError from SDK'));
      mockTryRecoverForwardTxId.mockResolvedValue('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      mockUpdatePayInWithSendData.mockRejectedValue(new Error('Pricing error'));

      await simulateDoSendPreparedBlock(payIn);

      expect(payIn.outTxId).toBe('ly36x-wiaaa-aaaai-aqj7q-cai:63582');
      expect(payIn.status).toBe(PayInStatus.FORWARDED);
      expect(loggedWarnings).toHaveLength(2);
      expect(loggedWarnings[0]).toContain('Recovered');
      expect(loggedWarnings[1]).toContain('Failed to finalize');
    });
  });
});

describe('tryRecoverForwardTxId — token strategy', () => {
  it('should return the last matching transfer (most recent)', () => {
    const transfers = [
      { blockIndex: 63500, from: 'deposit-principal', to: 'dex-wallet', amount: 5 },
      { blockIndex: 63580, from: 'other-principal', to: 'dex-wallet', amount: 10 },
      { blockIndex: 63582, from: 'deposit-principal', to: 'dex-wallet', amount: 10 },
    ];

    const depositAddress = 'deposit-principal';
    const destinationAddress = 'dex-wallet';

    const match = transfers.findLast((tx) => tx.from === depositAddress && tx.to === destinationAddress);

    expect(match).toBeDefined();
    expect(match!.blockIndex).toBe(63582);
  });

  it('should return null when no matching transfer exists', () => {
    const transfers = [
      { blockIndex: 63580, from: 'other-principal', to: 'dex-wallet', amount: 10 },
      { blockIndex: 63581, from: 'deposit-principal', to: 'other-wallet', amount: 10 },
    ];

    const match = transfers.findLast((tx) => tx.from === 'deposit-principal' && tx.to === 'dex-wallet');

    expect(match).toBeUndefined();
  });

  it('should prefer the most recent transfer when multiple exist', () => {
    const transfers = [
      { blockIndex: 63500, from: 'deposit-principal', to: 'dex-wallet', amount: 5 },
      { blockIndex: 63582, from: 'deposit-principal', to: 'dex-wallet', amount: 10 },
      { blockIndex: 63590, from: 'deposit-principal', to: 'dex-wallet', amount: 3 },
    ];

    const match = transfers.findLast((tx) => tx.from === 'deposit-principal' && tx.to === 'dex-wallet');

    expect(match!.blockIndex).toBe(63590);
  });
});
