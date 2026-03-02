import { IDL } from '@dfinity/candid';

/**
 * ICP Native Ledger IDL factory for `query_blocks`.
 *
 * The ICP native ledger (ryjl3-tyaaa-aaaaa-aaaba-cai) does NOT support `get_transactions`.
 * It only supports `query_blocks` which returns AccountIdentifier-based data.
 */
export const icpNativeLedgerIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const Tokens = IDL.Record({ e8s: IDL.Nat64 });
  const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });

  const Operation = IDL.Variant({
    Burn: IDL.Record({ from: IDL.Vec(IDL.Nat8), amount: Tokens, spender: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
    Mint: IDL.Record({ to: IDL.Vec(IDL.Nat8), amount: Tokens }),
    Transfer: IDL.Record({
      from: IDL.Vec(IDL.Nat8),
      to: IDL.Vec(IDL.Nat8),
      amount: Tokens,
      fee: Tokens,
      spender: IDL.Opt(IDL.Vec(IDL.Nat8)),
    }),
    Approve: IDL.Record({
      from: IDL.Vec(IDL.Nat8),
      spender: IDL.Vec(IDL.Nat8),
      allowance: Tokens,
      fee: Tokens,
      expected_allowance: IDL.Opt(Tokens),
      expires_at: IDL.Opt(TimeStamp),
    }),
  });

  const Transaction = IDL.Record({
    memo: IDL.Nat64,
    icrc1_memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    operation: IDL.Opt(Operation),
    created_at_time: TimeStamp,
  });

  const Block = IDL.Record({
    parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    transaction: Transaction,
    timestamp: TimeStamp,
  });

  return IDL.Service({
    query_blocks: IDL.Func(
      [IDL.Record({ start: IDL.Nat64, length: IDL.Nat64 })],
      [
        IDL.Record({
          chain_length: IDL.Nat64,
          certificate: IDL.Opt(IDL.Vec(IDL.Nat8)),
          blocks: IDL.Vec(Block),
          first_block_index: IDL.Nat64,
          // archived_blocks omitted: Candid skips unknown fields.
          // We only poll recent blocks from the tip, so archived blocks are not needed.
        }),
      ],
      ['query'],
    ),
  });
};

/**
 * ICRC Ledger IDL factory for `get_transactions` (ICRC-3).
 *
 * Used for ck-token canisters (ckBTC, ckETH, ckUSDC, ckUSDT) which embed their own index.
 * The ICP native ledger does NOT support this method.
 */
export const icrcLedgerIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const Transfer = IDL.Record({
    to: Account,
    fee: IDL.Opt(IDL.Nat),
    from: Account,
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
    amount: IDL.Nat,
    spender: IDL.Opt(Account),
  });

  const Transaction = IDL.Record({
    kind: IDL.Text,
    mint: IDL.Opt(
      IDL.Record({
        to: Account,
        amount: IDL.Nat,
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
      }),
    ),
    burn: IDL.Opt(
      IDL.Record({
        from: Account,
        amount: IDL.Nat,
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        spender: IDL.Opt(Account),
      }),
    ),
    transfer: IDL.Opt(Transfer),
    approve: IDL.Opt(
      IDL.Record({
        from: Account,
        spender: Account,
        amount: IDL.Nat,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        expected_allowance: IDL.Opt(IDL.Nat),
        expires_at: IDL.Opt(IDL.Nat64),
      }),
    ),
    timestamp: IDL.Nat64,
  });

  return IDL.Service({
    get_transactions: IDL.Func(
      [IDL.Record({ start: IDL.Nat, length: IDL.Nat })],
      [
        IDL.Record({
          first_index: IDL.Nat,
          log_length: IDL.Nat,
          transactions: IDL.Vec(Transaction),
        }),
      ],
      ['query'],
    ),
  });
};
