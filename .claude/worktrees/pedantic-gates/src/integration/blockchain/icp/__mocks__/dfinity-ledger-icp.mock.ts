export const IcpLedgerCanister = {
  create: () => ({
    transfer: jest.fn(),
    icrc1Transfer: jest.fn(),
    accountBalance: jest.fn(),
  }),
};

export const AccountIdentifier = {
  fromHex: jest.fn(),
};
