// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Minimal ERC-20 base
 */
contract TestERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function transfer(address to, uint256 value) public virtual returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}

/**
 * TestREALU - ERC-677 token (ERC-20 + transferAndCall)
 * Shares have 0 decimals in reality, but we keep 18 for compatibility
 */
contract TestREALU is TestERC20 {
    constructor() TestERC20("Test RealUnit", "tREALU") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);

        // Call onTokenTransfer on receiver
        (bool success,) = to.call(
            abi.encodeWithSignature("onTokenTransfer(address,uint256,bytes)", msg.sender, value, data)
        );
        require(success, "onTokenTransfer failed");
        return true;
    }
}

/**
 * TestZCHF - Simple ERC-20
 */
contract TestZCHF is TestERC20 {
    constructor() TestERC20("Test Frankencoin", "tZCHF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * TestBrokerBot - Receives REALU via transferAndCall, sends ZCHF back
 * Simulates selling shares: receives N REALU, sends back N * price ZCHF
 */
contract TestBrokerBot {
    TestREALU public immutable realu;
    TestZCHF public immutable zchf;
    uint256 public pricePerShare; // in ZCHF wei (18 decimals)

    event SharesSold(address indexed seller, uint256 shares, uint256 zchfAmount);

    constructor(address _realu, address _zchf, uint256 _pricePerShare) {
        realu = TestREALU(_realu);
        zchf = TestZCHF(_zchf);
        pricePerShare = _pricePerShare;
    }

    /**
     * Called by REALU token via transferAndCall (ERC-677)
     * REALU tokens are already transferred to this contract at this point
     */
    function onTokenTransfer(address from, uint256 value, bytes calldata) external {
        require(msg.sender == address(realu), "Only REALU token");

        uint256 zchfAmount = value * pricePerShare / 1e18;
        require(zchf.balanceOf(address(this)) >= zchfAmount, "Insufficient ZCHF liquidity");

        // Send ZCHF back to the seller
        require(zchf.transfer(from, zchfAmount), "ZCHF transfer failed");

        emit SharesSold(from, value, zchfAmount);
    }
}
