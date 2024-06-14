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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./ERC20PermitDelegateTransferWithMultiplier.sol";
import "./SanctionsList.sol";

/**
 * @dev
 *
 * This token contract is following the ERC20 standard.
 * It inherits ERC20PermitDelegateTransferWithMultiplier.sol, which extends the basic ERC20 to also allow permit, delegateTransfer and delegateTransferShares EIP-712 functionality.
 * Enforces Sanctions List via the Chainalysis standard interface.
 * The contract contains four roles:
 *  - A minter, that can mint new tokens.
 *  - A burner, that can burn its own tokens, or contract's tokens.
 *  - A pauser, that can pause or restore all transfers in the contract.
 *  - A multiplierUpdated, that can update value of a multiplier.
 *  - An owner, that can set the four above, and also the sanctionsList pointer.
 * The owner can also set who can use the EIP-712 functionality, either specific accounts via a whitelist, or everyone.
 *
 */

contract BackedTokenImplementationWithMultiplierAndAutoFeeAccrual is
    OwnableUpgradeable,
    ERC20PermitDelegateTransferWithMultiplier
{
    string public constant VERSION = "1.1.0";

    // Roles:
    address public minter;
    address public burner;
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

    // V2

    // Roles:
    address public multiplierUpdater;

    // Management Fee
    uint256 public lastTimeFeeApplied;
    uint256 public feePerPeriod; // in 1e18 precision
    uint256 public periodLength;

    // Events:
    event NewMinter(address indexed newMinter);
    event NewBurner(address indexed newBurner);
    event NewPauser(address indexed newPauser);
    event NewMultiplierUpdater(address indexed newMultiplierUpdater);
    event NewSanctionsList(address indexed newSanctionsList);
    event DelegateWhitelistChange(
        address indexed whitelistAddress,
        bool status
    );
    event DelegateModeChange(bool delegateMode);
    event PauseModeChange(bool pauseMode);
    event NewTerms(string newTerms);

    modifier allowedDelegate() {
        require(
            delegateMode || delegateWhitelist[_msgSender()],
            "BackedToken: Unauthorized delegate"
        );
        _;
    }

    modifier updateMultiplier() {
        (uint256 newMultiplier, uint256 periodsPassed) = getCurrentMultiplier();
        lastTimeFeeApplied = lastTimeFeeApplied + periodLength * periodsPassed;
        if (multiplier() != newMultiplier) {
            _updateMultiplier(newMultiplier);
        }
        _;
    }

    // constructor, call initializer to lock the implementation instance.
    constructor() {
        initialize(
            "Backed Token Implementation",
            "BTI"
        );
    }

    function initialize(
        string memory name_,
        string memory symbol_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        __Ownable_init();
        _buildDomainSeparator();
        _setTerms("https://www.backedassets.fi/legal-documentation"); // Default Terms
        periodLength = 24 * 3600; // Set to 24h by default
        lastTimeFeeApplied = block.timestamp;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(
        address account
    ) public view virtual override returns (uint256) {
        (uint256 multiplier, ) = getCurrentMultiplier();
        return (sharesOf(account) * multiplier) / 1e18;
    }

    /**
     * @dev Retrieves most up to date value of multiplier
     *
     * Note Probably it should be renamed into multiplier and allow getting stored version of multiplier
     * via getStoredMultiplier() method
     */
    function getCurrentMultiplier()
        public
        view
        virtual
        returns (uint256 newMultiplier, uint256 periodsPassed)
    {
        periodsPassed = (block.timestamp - lastTimeFeeApplied) / periodLength;
        newMultiplier = multiplier();
        if (feePerPeriod >= 0) {
            for (uint256 index = 0; index < periodsPassed; index++) {
                newMultiplier = (newMultiplier * (1e18 - feePerPeriod)) / 1e18;
            }
        }
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        (uint256 multiplier, ) = getCurrentMultiplier();
        return _totalShares * multiplier / 1e18;
    }

    /**
     * @dev Update allowance with a signed permit. Allowed only if
     *  the sender is whitelisted, or the delegateMode is set to true
     *
     * @param owner       Token owner's address (Authorizer)
     * @param spender     Spender's address
     * @param value       Amount of allowance
     * @param deadline    Expiration time, seconds since the epoch
     * @param v           v part of the signature
     * @param r           r part of the signature
     * @param s           s part of the signature
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegate {
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    /**
     * @dev Perform an intended transfer on one account's behalf, from another account,
     *  who actually pays fees for the transaction. Allowed only if the sender
     *  is whitelisted, or the delegateMode is set to true
     *
     * @param owner       The account that provided the signature and from which the tokens will be taken
     * @param to          The account that will receive the tokens
     * @param value       The amount of tokens to transfer
     * @param deadline    Expiration time, seconds since the epoch
     * @param v           v part of the signature
     * @param r           r part of the signature
     * @param s           s part of the signature
     */
    function delegatedTransfer(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegate updateMultiplier {
        super.delegatedTransfer(owner, to, value, deadline, v, r, s);
    }
    
    /**
     * @dev Perform an intended shares transfer on one account's behalf, from another account,
     *  who actually pays fees for the transaction. Allowed only if the sender
     *  is whitelisted, or the delegateMode is set to true
     *
     * @param owner       The account that provided the signature and from which the tokens will be taken
     * @param to          The account that will receive the tokens
     * @param value       The amount of token shares to transfer
     * @param deadline    Expiration time, seconds since the epoch
     * @param v           v part of the signature
     * @param r           r part of the signature
     * @param s           s part of the signature
     */
    function delegatedTransferShares(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override updateMultiplier {
        super.delegatedTransferShares(owner, to, value, deadline, v, r, s);
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(
        address to,
        uint256 amount
    ) public virtual override updateMultiplier returns (bool) {
        return super.transfer(to, amount);
    }

    /**
     * @dev Transfers underlying shares to destination account
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `sharesAmount`.
     */
    function transferShares(
        address to,
        uint256 sharesAmount
    ) public virtual override updateMultiplier returns (bool) {
        return super.transferShares(to, sharesAmount);
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `amount`.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override updateMultiplier returns (bool) {
        return this.transferFrom(from, to, amount);
    }

    /**
     * @dev Function to mint tokens. Allowed only for minter
     *
     * @param account   The address that will receive the minted tokens
     * @param amount    The amount of tokens to mint
     */
    function mint(
        address account,
        uint256 amount
    ) external virtual updateMultiplier {
        require(_msgSender() == minter, "BackedToken: Only minter");
        uint256 sharesAmount = getSharesByUnderlyingAmount(amount);
        _mintShares(account, sharesAmount);
    }

    /**
     * @dev Function to burn tokens. Allowed only for burner. The burned tokens
     *  must be from the burner (msg.sender), or from the contract itself
     *
     * @param account   The account from which the tokens will be burned
     * @param amount    The amount of tokens to be burned
     */
    function burn(address account, uint256 amount) external updateMultiplier {
        require(_msgSender() == burner, "BackedToken: Only burner");
        require(
            account == _msgSender() || account == address(this),
            "BackedToken: Cannot burn account"
        );
        uint256 sharesAmount = getSharesByUnderlyingAmount(amount);
        _burnShares(account, sharesAmount);
    }

    /**
     * @dev Function to set the new fee. Allowed only for owner
     *
     * @param newFeePerPeriod The new fee per period value
     */
    function updateFeePerPeriod(uint256 newFeePerPeriod) external onlyOwner {
        feePerPeriod = newFeePerPeriod;
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
        require(_msgSender() == pauser, "BackedToken: Only pauser");
        isPaused = newPauseMode;
        emit PauseModeChange(newPauseMode);
    }

    /**
     * @dev Function to change the contract minter. Allowed only for owner
     *
     * Emits a { NewMinter } event
     *
     * @param newMinter The address of the new minter
     */
    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit NewMinter(newMinter);
    }

    /**
     * @dev Function to change the contract burner. Allowed only for owner
     *
     * Emits a { NewBurner } event
     *
     * @param newBurner The address of the new burner
     */
    function setBurner(address newBurner) external onlyOwner {
        burner = newBurner;
        emit NewBurner(newBurner);
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
     * @dev Function to change the contract multiplier updater. Allowed only for owner
     *
     * Emits a { NewMultiplierUpdater } event
     *
     * @param newMultiplierUpdater The address of the new multiplier updater
     */
    function setMultiplierUpdater(address newMultiplierUpdater) external onlyOwner {
        multiplierUpdater = newMultiplierUpdater;
        emit NewMultiplierUpdater(newMultiplierUpdater);
    }

    /**
     * @dev Function to change the contract multiplier, only if oldMultiplier did not change in the meantime. Allowed only for owner
     *
     * Emits a { MultiplierChanged } event
     *
     * @param newMultiplier New multiplier value
     */
    function updateMultiplierValue(
        uint256 newMultiplier,
        uint256 oldMultiplier
    ) external updateMultiplier {
        require(
            _msgSender() == multiplierUpdater,
            "BackedToken: Only multiplier updater"
        );
        require(
            multiplier() == oldMultiplier,
            "BackedToken: Multiplier changed in the meantime"
        );
        _updateMultiplier(newMultiplier);
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
        require(
            !SanctionsList(newSanctionsList).isSanctioned(address(this)),
            "BackedToken: Wrong List interface"
        );

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
    function setDelegateWhitelist(
        address whitelistAddress,
        bool status
    ) external onlyOwner {
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
    
    /**
     * @dev Function to change the time of last fee accrual. Allowed only for owner
     *
     * @param newLastTimeFeeApplied A timestamp of last time fee was applied
     */
    function setLastTimeFeeApplied(uint256 newLastTimeFeeApplied) external onlyOwner {
        lastTimeFeeApplied = newLastTimeFeeApplied;
    } 
    
    /**
     * @dev Function to change period length. Allowed only for owner
     *
     * @param newPeriodLength Length of a single accrual period in seconds
     */
    function setPeriodLength(uint256 newPeriodLength) external onlyOwner {
        periodLength = newPeriodLength;
    } 

    // Implement setTerms, to allow also to use from initializer:
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
        require(!isPaused, "BackedToken: token transfer while paused");

        // Check Sanctions List, but do not prevent minting burning:
        if (from != address(0) && to != address(0)) {
            require(
                !sanctionsList.isSanctioned(from),
                "BackedToken: sender is sanctioned"
            );
            require(
                !sanctionsList.isSanctioned(to),
                "BackedToken: receiver is sanctioned"
            );
        }

        super._beforeTokenTransfer(from, to, amount);
    }

    // Implement the SanctionsList functionality for spender:
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override {
        require(
            !sanctionsList.isSanctioned(spender),
            "BackedToken: spender is sanctioned"
        );

        super._spendAllowance(owner, spender, amount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
