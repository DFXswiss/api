// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../DfxGaslessSell.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockERC20Failing {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract DfxGaslessSellTest is Test {
    DfxGaslessSell public implementation;
    MockERC20 public token;

    address public recipient = makeAddr("recipient");

    // User with known private key
    uint256 public userPrivateKey = 0x1234567890abcdef;
    address public user;

    event TokenTransferred(address indexed token, address indexed from, address indexed recipient, uint256 amount, uint256 nonce);

    function setUp() public {
        user = vm.addr(userPrivateKey);
        implementation = new DfxGaslessSell();
        token = new MockERC20();
    }

    /// @dev Simulates EIP-7702 by deploying contract code at user's EOA address
    function _setupEIP7702(address userEOA) internal returns (DfxGaslessSell) {
        // Deploy implementation to get bytecode
        DfxGaslessSell impl = new DfxGaslessSell();

        // Copy code to user's EOA (simulating EIP-7702 delegation)
        vm.etch(userEOA, address(impl).code);

        return DfxGaslessSell(userEOA);
    }

    function _signTransfer(
        address signer,
        uint256 signerKey,
        address tokenAddr,
        uint256 amount,
        address recipientAddr,
        uint256 currentNonce,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 innerHash = keccak256(abi.encode(
            signer,
            tokenAddr,
            amount,
            recipientAddr,
            currentNonce,
            deadline,
            block.chainid
        ));
        bytes32 hash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            innerHash
        ));
        (v, r, s) = vm.sign(signerKey, hash);
    }

    // =============================================================
    //                      DEPLOYMENT
    // =============================================================

    function test_Version() public view {
        assertEq(implementation.version(), "1.0.0");
    }

    function test_InitialNonceIsZero() public view {
        assertEq(implementation.nonce(), 0);
    }

    // =============================================================
    //                      EXECUTE TRANSFER (EIP-7702 simulated)
    // =============================================================

    function test_ExecuteTransfer_Success() public {
        // Setup EIP-7702: Contract code at user's EOA
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;

        // Give user tokens
        token.mint(user, amount);

        // User signs the transfer (signer address = user = address(this) in contract)
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user,           // This will be address(this) in the contract
            userPrivateKey,
            address(token),
            amount,
            recipient,     // recipient
            0,              // nonce
            deadline
        );

        // Execute
        vm.expectEmit(true, true, true, true);
        emit TokenTransferred(address(token), user, recipient, amount, 0);

        userContract.executeTransfer(address(token), amount, recipient, deadline, v, r, s);

        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(user), 0);
        assertEq(userContract.nonce(), 1);
    }

    function test_ExecuteTransfer_RevertsOnInvalidSignature() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;

        // Sign with wrong key
        uint256 wrongKey = 0xdeadbeef;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, wrongKey, address(token), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidSignature.selector);
        userContract.executeTransfer(address(token), 100, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnWrongAmount() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;

        // Sign for 100, try with 200
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidSignature.selector);
        userContract.executeTransfer(address(token), 200, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnWrongRecipient() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        address otherRecipient = makeAddr("otherRecipient");

        // Sign for recipient, try with different recipient
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidSignature.selector);
        userContract.executeTransfer(address(token), 100, otherRecipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnReplayAttack() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;

        token.mint(user, amount * 2);

        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), amount, recipient, 0, deadline
        );

        // First execution succeeds
        userContract.executeTransfer(address(token), amount, recipient, deadline, v, r, s);
        assertEq(userContract.nonce(), 1);

        // Second execution fails (nonce changed)
        vm.expectRevert(DfxGaslessSell.InvalidSignature.selector);
        userContract.executeTransfer(address(token), amount, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnExpiredDeadline() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.ExpiredDeadline.selector);
        userContract.executeTransfer(address(token), 100, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnZeroToken() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(0), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidToken.selector);
        userContract.executeTransfer(address(0), 100, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnZeroRecipient() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 100, address(0), 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidRecipient.selector);
        userContract.executeTransfer(address(token), 100, address(0), deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnZeroAmount() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 0, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InvalidAmount.selector);
        userContract.executeTransfer(address(token), 0, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnInsufficientBalance() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        // No tokens minted
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), 100, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.InsufficientBalance.selector);
        userContract.executeTransfer(address(token), 100, recipient, deadline, v, r, s);
    }

    function test_ExecuteTransfer_RevertsOnFailedTransfer() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        MockERC20Failing failingToken = new MockERC20Failing();
        failingToken.mint(user, 100 ether);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(failingToken), 100 ether, recipient, 0, deadline
        );

        vm.expectRevert(DfxGaslessSell.TransferFailed.selector);
        userContract.executeTransfer(address(failingToken), 100 ether, recipient, deadline, v, r, s);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    function test_GetTransferHash() public {
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 hash = userContract.getTransferHash(address(token), 100, recipient, deadline);

        bytes32 expectedHash = keccak256(abi.encode(
            user,
            address(token),
            100,
            recipient,
            0,
            deadline,
            block.chainid
        ));

        assertEq(hash, expectedHash);
    }

    // =============================================================
    //                      FUZZ TESTS
    // =============================================================

    function testFuzz_ExecuteTransfer(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        DfxGaslessSell userContract = _setupEIP7702(user);

        token.mint(user, amount);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), amount, recipient, 0, deadline
        );

        userContract.executeTransfer(address(token), amount, recipient, deadline, v, r, s);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_ExecuteTransfer_ToDifferentRecipient() public {
        // Test that user can send to any recipient they sign for
        DfxGaslessSell userContract = _setupEIP7702(user);

        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        address customRecipient = makeAddr("customRecipient");

        token.mint(user, amount);

        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(
            user, userPrivateKey, address(token), amount, customRecipient, 0, deadline
        );

        userContract.executeTransfer(address(token), amount, customRecipient, deadline, v, r, s);

        assertEq(token.balanceOf(customRecipient), amount);
        assertEq(token.balanceOf(user), 0);
    }
}
