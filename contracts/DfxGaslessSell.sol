// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DfxGaslessSell
 * @author DFX AG
 * @notice EIP-7702 delegation contract for gasless token transfers
 * @dev Users must sign each transfer request using EIP-712 typed data.
 *      The signature is verified before execution to prevent unauthorized transfers.
 *      Abuse protection is handled at the relayer level (DFX only relays to DFX addresses).
 *
 * Flow:
 * 1. User signs EIP-7702 authorization (delegates EOA to this contract)
 * 2. User signs EIP-712 typed data (token, amount, recipient, nonce, deadline)
 * 3. DFX relayer validates recipient and submits transaction
 * 4. Contract verifies user signature and executes transfer
 */

contract DfxGaslessSell {
    using SafeERC20 for IERC20;

    // =============================================================
    //                        EIP-712 CONSTANTS
    // =============================================================

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address token,uint256 amount,address recipient,uint256 nonce,uint256 deadline)");

    bytes32 private constant NAME_HASH = keccak256("DfxGaslessSell");
    bytes32 private constant VERSION_HASH = keccak256("1");

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

        // Verify EIP-712 signature - signer must be this address (user's EOA via EIP-7702)
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            token,
            amount,
            recipient,
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            _domainSeparator(),
            structHash
        ));

        address signer = ecrecover(digest, v, r, s);
        if (signer != address(this)) revert InvalidSignature();

        // Increment nonce (replay protection)
        uint256 currentNonce = nonce++;

        // Execute transfer
        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();

        tokenContract.safeTransfer(recipient, amount);

        emit TokenTransferred(token, address(this), recipient, amount, currentNonce);
    }

    // =============================================================
    //                         VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get the EIP-712 domain separator
     * @dev Computed dynamically since address(this) varies per user EOA
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    /**
     * @notice Get the EIP-712 digest that needs to be signed for a transfer
     * @param token The ERC-20 token address
     * @param amount The amount to transfer
     * @param recipient The address to receive tokens
     * @param deadline Timestamp after which signature is invalid
     * @return The EIP-712 digest to sign
     */
    function getTransferHash(
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            token,
            amount,
            recipient,
            nonce,
            deadline
        ));

        return keccak256(abi.encodePacked(
            "\x19\x01",
            _domainSeparator(),
            structHash
        ));
    }

    /// @notice Get contract version
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // =============================================================
    //                      INTERNAL FUNCTIONS
    // =============================================================

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            NAME_HASH,
            VERSION_HASH,
            block.chainid,
            address(this)
        ));
    }
}
