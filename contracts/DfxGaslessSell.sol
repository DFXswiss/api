// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DfxGaslessSell
 * @author DFX AG
 * @notice EIP-7702 delegation contract for gasless token transfers
 * @dev Users must sign each transfer request including the recipient.
 *      The signature is verified before execution to prevent unauthorized transfers.
 *      Abuse protection is handled at the relayer level (DFX only relays to DFX addresses).
 *
 * Flow:
 * 1. User signs EIP-7702 authorization (delegates EOA to this contract)
 * 2. User signs transfer parameters (token, amount, recipient, nonce, deadline)
 * 3. DFX relayer validates recipient and submits transaction
 * 4. Contract verifies user signature and executes transfer
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract DfxGaslessSell {
    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice Nonce for replay protection (per-EOA when delegated)
    uint256 public nonce;

    // =============================================================
    //                            EVENTS
    // =============================================================

    event TokenTransferred(
        address indexed token,
        address indexed from,
        address indexed recipient,
        uint256 amount,
        uint256 nonce
    );

    // =============================================================
    //                            ERRORS
    // =============================================================

    error InvalidToken();
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidSignature();
    error ExpiredDeadline();
    error InsufficientBalance();
    error TransferFailed();

    // =============================================================
    //                      EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Transfer ERC-20 tokens with signature verification
     * @param token The ERC-20 token address
     * @param amount The amount to transfer
     * @param recipient The address to receive tokens (validated by relayer)
     * @param deadline Timestamp after which signature is invalid
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     */
    function executeTransfer(
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (token == address(0)) revert InvalidToken();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert ExpiredDeadline();

        // Verify signature - signer must be this address (user's EOA via EIP-7702)
        bytes32 hash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encode(
                address(this),  // User's EOA
                token,
                amount,
                recipient,
                nonce,
                deadline,
                block.chainid
            ))
        ));

        address signer = ecrecover(hash, v, r, s);
        if (signer != address(this)) revert InvalidSignature();

        // Increment nonce (replay protection)
        uint256 currentNonce = nonce++;

        // Execute transfer
        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();

        bool success = tokenContract.transfer(recipient, amount);
        if (!success) revert TransferFailed();

        emit TokenTransferred(token, address(this), recipient, amount, currentNonce);
    }

    // =============================================================
    //                         VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get the hash that needs to be signed for a transfer
     * @param token The ERC-20 token address
     * @param amount The amount to transfer
     * @param recipient The address to receive tokens
     * @param deadline Timestamp after which signature is invalid
     * @return The message hash to sign
     */
    function getTransferHash(
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline
    ) external view returns (bytes32) {
        return keccak256(abi.encode(
            address(this),
            token,
            amount,
            recipient,
            nonce,
            deadline,
            block.chainid
        ));
    }

    /// @notice Get contract version
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
