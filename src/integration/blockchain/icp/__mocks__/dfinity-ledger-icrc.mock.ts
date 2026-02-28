export const IcrcLedgerCanister = {
  create: () => ({
    balance: jest.fn(),
    transactionFee: jest.fn(),
    transfer: jest.fn(),
    icrc1Transfer: jest.fn(),
  }),
};
