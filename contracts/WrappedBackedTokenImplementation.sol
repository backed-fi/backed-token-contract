/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2021-2022 Backed Finance AG
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

/**
 * Disclaimer and Terms of Use
 *
 * These ERC-20 tokens have not been registered under the U.S. Securities Act of 1933, as
 * amended or with any securities regulatory authority of any State or other jurisdiction
 * of the United States and (i) may not be offered, sold or delivered within the United States
 * to, or for the account or benefit of U.S. Persons, and (ii) may be offered, sold or otherwise
 * delivered at any time only to transferees that are Non-United States Persons (as defined by 
 * the U.S. Commodities Futures Trading Commission). 
 * For more information and restrictions please refer to the issuer's [Website](https://www.backedassets.fi/legal-documentation)
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable-new/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable-new/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable-new/access/OwnableUpgradeable.sol";
import "./SanctionsList.sol";

/**
 * @dev
 *
 * This token contract is following the ERC20 standard.
 * It inherits ERC4626Upgradeable, which extends the basic ERC20 to be a representation of changing underlying token.
 * Enforces Sanctions List via the Chainalysis standard interface.
 * The contract contains one role:
 *  - A pauser, that can pause or restore all transfers in the contract.
 *  - An owner, that can set the above, and also the sanctionsList pointer.
 * The owner can also set who can use the EIP-712 functionality, either specific accounts via a whitelist, or everyone.
 * 
 */

contract WrappedBackedTokenImplementation is OwnableUpgradeable, ERC4626Upgradeable, ERC20PermitUpgradeable {
    string constant public VERSION = "1.0.0";

    // Calculating the Delegated Transfer typehash:
    bytes32 public constant DELEGATED_TRANSFER_TYPEHASH =
        keccak256("DELEGATED_TRANSFER(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)");

    // Roles:
    address public pauser;

    // EIP-712 Delegate Functionality:
    bool public delegateMode;
    mapping(address => bool) public delegateWhitelist;

    // Pause:
    bool public isPaused;

    // SanctionsList:
    SanctionsList public sanctionsList;

    // Terms:
    string public terms;

    // Events:
    event NewPauser(address indexed newPauser);
    event NewSanctionsList(address indexed newSanctionsList);
    event DelegateWhitelistChange(address indexed whitelistAddress, bool status);
    event DelegateModeChange(bool delegateMode);
    event PauseModeChange(bool pauseMode);
    event NewTerms(string newTerms);

    modifier allowedDelegate {
        require(delegateMode || delegateWhitelist[_msgSender()], "WrappedBackedToken: Unauthorized delegate");
        _;
    }


    // constructor, call initializer to lock the implementation instance.
    constructor () {
        initialize("Wrapped Backed Token Implementation", "wBTI", address(0x0000000000000000000000000000000000000000));
    }

    function initialize(string memory name_, string memory symbol_, address underlying_) public initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __ERC4626_init(IERC20Upgradeable(underlying_));
        __Ownable_init();
        _setTerms("https://www.backedassets.fi/legal-documentation"); // Default Terms
    }

    /**
     * @inheritdoc IERC20MetadataUpgradeable
     */
    function decimals() public view virtual override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return ERC4626Upgradeable.decimals();
    }

    /**
     * @inheritdoc IERC20PermitUpgradeable
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override allowedDelegate {
        super.permit(owner, spender, value, deadline, v, r, s);
    }
    
    /**
     * @dev Delegated Transfer, transfer via a sign message, using erc712.
     */
    function delegatedTransfer(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual allowedDelegate {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(abi.encode(DELEGATED_TRANSFER_TYPEHASH, owner, to, value, _useNonce(owner), deadline));

        
        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSAUpgradeable.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");

        _transfer(owner, to, value);
    }

    /**
     * @dev Function to set the pause in order to block or restore all
     *  transfers. Allowed only for pauser
     *
     * Emits a { PauseModeChange } event
     *
     * @param newPauseMode The new pause mode
     */
    function setPause(bool newPauseMode) external {
        require(_msgSender() == pauser, "WrappedBackedToken: Only pauser");
        isPaused = newPauseMode;
        emit PauseModeChange(newPauseMode);
    }

    /**
     * @dev Function to change the contract pauser. Allowed only for owner
     *
     * Emits a { NewPauser } event
     *
     * @param newPauser The address of the new pauser
     */
    function setPauser(address newPauser) external onlyOwner {
        pauser = newPauser;
        emit NewPauser(newPauser);
    }

    /**
     * @dev Function to change the contract Senctions List. Allowed only for owner
     *
     * Emits a { NewSanctionsList } event
     *
     * @param newSanctionsList The address of the new Senctions List following the Chainalysis standard
     */
    function setSanctionsList(address newSanctionsList) external onlyOwner {
        // Check the proposed sanctions list contract has the right interface:
        require(!SanctionsList(newSanctionsList).isSanctioned(address(this)), "WrappedBackedToken: Wrong List interface");

        sanctionsList = SanctionsList(newSanctionsList);
        emit NewSanctionsList(newSanctionsList);
    }


    /**
     * @dev EIP-712 Function to change the delegate status of account.
     *  Allowed only for owner
     *
     * Emits a { DelegateWhitelistChange } event
     *
     * @param whitelistAddress  The address for which to change the delegate status
     * @param status            The new delegate status
     */
    function setDelegateWhitelist(address whitelistAddress, bool status) external onlyOwner {
        delegateWhitelist[whitelistAddress] = status;
        emit DelegateWhitelistChange(whitelistAddress, status);
    }

    /**
     * @dev EIP-712 Function to change the contract delegate mode. Allowed
     *  only for owner
     *
     * Emits a { DelegateModeChange } event
     *
     * @param _delegateMode The new delegate mode for the contract
     */
    function setDelegateMode(bool _delegateMode) external onlyOwner {
        delegateMode = _delegateMode;

        emit DelegateModeChange(_delegateMode);
    }

    /**
     * @dev Function to change the contract terms. Allowed only for owner
     *
     * Emits a { NewTerms } event
     *
     * @param newTerms A string with the terms. Usually a web or IPFS link.
     */
    function setTerms(string memory newTerms) external onlyOwner {
        _setTerms(newTerms);
    }

    // Implement setTerms, tp allow also to use from initializer:
    function _setTerms(string memory newTerms) internal virtual {
        terms = newTerms;
        emit NewTerms(newTerms);
    }

    // Implement the pause and SanctionsList functionality before transfer:
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Check not paused:
        require(!isPaused, "WrappedBackedToken: token transfer while paused");

        if (from != address(0)) {
            require(!sanctionsList.isSanctioned(from), "WrappedBackedToken: sender is sanctioned");
        }
        if (to != address(0)) {
            require(!sanctionsList.isSanctioned(to), "WrappedBackedToken: receiver is sanctioned");
        }

        super._beforeTokenTransfer(from, to, amount);
    }

    // Implement the SanctionsList functionality for spender:
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override {
        require(!sanctionsList.isSanctioned(spender), "WrappedBackedToken: spender is sanctioned");

        super._spendAllowance(owner, spender, amount);
    }
    
}
