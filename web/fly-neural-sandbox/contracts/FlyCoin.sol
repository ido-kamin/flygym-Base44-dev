// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title FlyCoin — a fixed-supply ERC-20 that records the Base44 DNA of the fly that "compiled" it.
/// @notice Novelty token from the Fly Neural Sandbox. No owner, no mint function, no sale logic:
///         the whole supply goes to the deployer, and `dna` is immutable once deployed.
contract FlyCoin {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    /// @notice 10-character Base44 DNA (genome, score, pose) of the fly.
    string public dna;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, string memory dna_, uint256 supply) {
        name = name_;
        symbol = symbol_;
        dna = dna_;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "FlyCoin: allowance");
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "FlyCoin: zero address");
        uint256 balance = balanceOf[from];
        require(balance >= value, "FlyCoin: balance");
        unchecked {
            balanceOf[from] = balance - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
