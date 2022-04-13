/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2021-2022 Backed
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./ERC20PermitDelegateTransfer.sol";

/**
 * @dev
 *
 * This token contract is following the ERC20 standard.
 * It inherits ERC20PermitDelegateTransfer.sol, which extends the basic ERC20 to also allow permit and delegateTransfer ERC712 functionality.
 * The contract contains three roles:
 *  - A minter, that can mint new tokens.
 *  - A burner, that can burn its own tokens, or contract's tokens.
 *  - A pauser, that can pause or restore all transfers in the contract.
 *  - An owner, that can set the three above.
 * The owner can also set who can use the ERC712 functionality, either specific accounts via a whitelist, or everyone.
 * 
 */

contract BackedTokenImplementation is OwnableUpgradeable, ERC20PermitDelegateTransfer {
    // Roles:
    address public minter;
    address public burner;
    address public pauser;

    // ERC712 delegation:
    bool public delegateMode;
    mapping(address => bool) public delegateWhitelist;

    // Pause:
    bool public isPaused;

    // Events:
    event NewMinter(address indexed newMinter);
    event NewBurner(address indexed newBurner);
    event NewPauser(address indexed newPauser);
    event DelegationWhitelistChange(address indexed whitelistAddress, bool status);
    event DelegationModeChange(bool delegationMode);
    event PauseModeChange(bool pauseMode);

    modifier allowedDelegation {
        require(delegateMode || delegateWhitelist[_msgSender()], "BackedToken: Unauthorized delegate");
        _;
    }


    // constructor, call initializer to lock the implementation instance.
    constructor () {
        initialize("Backed Token Implementation", "BTI");
    }

    // initialize, call initializer to lock the implementation instance.
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20_init(name_, symbol_);
        __Ownable_init();
        _buildDomainSeparator();
    }

    // Permit, uses super, allowed only if delegationMode is true, or if the relayer is whitelisted:
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegation {
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    // Delegated Transfer, uses super, allowed only if delegationMode is true, or if the relayer is whitelisted:
    function delegatedTransfer(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegation {
        super.delegatedTransfer(owner, to, value, deadline, v, r, s);
    }

    // Mint new tokens, only allowed for minter:
    function mint(address account, uint256 amount) public {
        require(_msgSender() == minter, "BackedToken: Only minter");
        _mint(account, amount);
    }

    // Burn tokens from msg.sender account, or from the contract itself. Only allowed for burner:
    function burn(address account, uint256 amount) public {
        require(_msgSender() == burner, "BackedToken: Only burner");
        require(account == _msgSender() || account == address(this), "BackedToken: Cannot burn account");
        _burn(account, amount);
    }

    // Set pause, to block or restore all transfers. Only allowed for pauser:
    function setPause(bool newPauseMode) public {
        require(_msgSender() == pauser, "BackedToken: Only pauser");
        isPaused = newPauseMode;
        emit PauseModeChange(newPauseMode);
    }

    // Set minter, only owner:
    function setMinter(address newMinter) public onlyOwner {
        minter = newMinter;
        emit NewMinter(newMinter);
    }

    // Set burner, only owner:
    function setBurner(address newBurner) public onlyOwner {
        burner = newBurner;
        emit NewBurner(newBurner);
    }

    // Set pauser, only owner:
    function setPauser(address newPauser) public onlyOwner {
        pauser = newPauser;
        emit NewPauser(newPauser);
    }

    // ERC712 set delegation whitelist, only owner:
    function setDelegationWhitelist(address whitelistAddress, bool status) public onlyOwner {
        delegateWhitelist[whitelistAddress] = status;
        emit DelegationWhitelistChange(whitelistAddress, status);
    }

    // ERC712 set delegation mode, only owner:
    function setDelegateMode(bool delegationMode) public onlyOwner {
        delegateMode = delegationMode;
        emit DelegationModeChange(delegationMode);
    }

    // Implement the pause functionality:
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        require(!isPaused, "BackedToken: token transfer while paused");

        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[47] private __gap;
}
