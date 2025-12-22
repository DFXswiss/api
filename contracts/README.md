# DFX Gasless Contracts

EIP-7702 delegation contract for gasless token transfers.

## Overview

Enables users to sell tokens to DFX **without owning ETH**. Users sign an off-chain authorization, and DFX pays the gas.

## Contract

### DfxGaslessSell.sol

| Function | Description |
|----------|-------------|
| `executeTransfer(token, amount, recipient, deadline, v, r, s)` | Transfer ERC-20 tokens with signature verification |
| `getTransferHash(token, amount, recipient, deadline)` | Get hash to sign for a transfer |
| `nonce()` | Current nonce for replay protection |
| `version()` | Returns contract version |

## How It Works

```
1. User signs EIP-7702 authorization (off-chain, no gas)
2. User signs transfer parameters (token, amount, recipient, nonce, deadline)
3. DFX relayer validates recipient and submits transaction (DFX pays gas)
4. Contract verifies user signature and executes transfer
```

## Signature Format

User signs:
```
keccak256(abi.encode(
    address(this),  // User's EOA
    token,          // Token address
    amount,         // Amount to transfer
    recipient,      // Recipient address
    nonce,          // Current nonce
    deadline,       // Expiration timestamp
    block.chainid   // Chain ID
))
```

## Security

- **Signature per transfer**: Every transfer requires user signature
- **Replay protection**: Nonce increments after each transfer
- **Deadline**: Signatures expire after deadline
- **Recipient validation**: Handled at relayer level (DFX only relays to DFX addresses)
- **No admin keys**: Contract has no owner or privileged functions

**Note:** Pending security audit.

## Development

### Prerequisites

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Setup

```bash
cd api/contracts
forge install foundry-rs/forge-std --no-commit
```

### Test

```bash
forge test
```

### Build

```bash
forge build
```

## Deployment

| Network | Address | Status |
|---------|---------|--------|
| Ethereum Mainnet | - | Not deployed |

## License

MIT
