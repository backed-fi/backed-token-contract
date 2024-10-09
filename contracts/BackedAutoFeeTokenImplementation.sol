/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2021-2024 Backed Finance AG
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
import "./BackedTokenImplementation.sol";

/**
 * @dev
 *
 * This token contract is following the ERC20 standard.
 * It inherits BackedTokenImplementation.sol, which is base Backed token implementation. BackedAutoFeeTokenImplementation extends it
 * with logic of multiplier, which is used for rebasing logic of the token, thus becoming rebase token itself. Additionally, it contains
 * mechanism, which changes this multiplier per configured fee periodically, on defined period length.
 * It contains one additional role:
 *  - A multiplierUpdater, that can update value of a multiplier.
 *
 */

contract BackedAutoFeeTokenImplementation is BackedTokenImplementation {
    // Calculating the Delegated Transfer Shares typehash:
    bytes32 constant public DELEGATED_TRANSFER_SHARES_TYPEHASH =
        keccak256(
            "DELEGATED_TRANSFER_SHARES(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // Roles:
    address public multiplierUpdater;

    // Management Fee
    uint256 public lastTimeFeeApplied;
    uint256 public feePerPeriod; // in 1e18 precision
    uint256 public periodLength;

    /**
     * @dev Defines ratio between a single share of a token to balance of a token.
     * Defined in 1e18 precision.
     *
     */
    uint256 public multiplier;

    mapping(address => uint256) private _shares;

    uint256 internal _totalShares;

    uint256 public multiplierNonce;

    // Events:

    /**
     * @dev Emitted when multiplier updater is changed
     */
    event NewMultiplierUpdater(address indexed newMultiplierUpdater);

    /**
     * @dev Emitted when `value` token shares are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event TransferShares(
        address indexed from,
        address indexed to,
        uint256 value
    );

    /**
     * @dev Emitted when multiplier value is updated
     */
    event MultiplierUpdated(uint256 value);

    // Modifiers:

    modifier updateMultiplier() {
        (uint256 newMultiplier, uint256 periodsPassed, uint256 newMultiplierNonce) = getCurrentMultiplier();
        lastTimeFeeApplied = lastTimeFeeApplied + periodLength * periodsPassed;
        if (multiplier != newMultiplier) {
            _updateMultiplier(newMultiplier, newMultiplierNonce);
        }
        _;
    }

    modifier onlyMultiplierUpdater() {
        require(
            _msgSender() == multiplierUpdater,
            "BackedToken: Only multiplier updater"
        );
        _;
    }

    modifier onlyUpdatedMultiplier(uint256 oldMultiplier) {
        require(
            multiplier == oldMultiplier,
            "BackedToken: Multiplier changed in the meantime"
        );
        _;
    }

    modifier onlyNewerMultiplierNonce(uint256 newMultiplierNonce) {
        require(
            multiplierNonce < newMultiplierNonce,
            "BackedToken: Multiplier nonce is outdated."
        );
        _;
    }
    
    // constructor, set lastTimeFeeApplied to lock the implementation instance.
    constructor () {
        lastTimeFeeApplied = 1;
    }

    // Initializers:
    function initialize(
        string memory name_,
        string memory symbol_
    ) public virtual override {
        super.initialize(name_, symbol_);
        _initialize_auto_fee(24 * 3600, block.timestamp, 0);
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 _periodLength,
        uint256 _lastTimeFeeApplied,
        uint256 _feePerPeriod
    ) external virtual {
        super.initialize(name_, symbol_);
        _initialize_auto_fee(_periodLength, _lastTimeFeeApplied, _feePerPeriod);
    }

    // Should it be only callable by authorized address?
    function initialize_v2(
        uint256 _periodLength,
        uint256 _lastTimeFeeApplied,
        uint256 _feePerPeriod
    ) external virtual {
        _initialize_auto_fee(_periodLength, _lastTimeFeeApplied, _feePerPeriod);
    }

    function _initialize_auto_fee(
        uint256 _periodLength,
        uint256 _lastTimeFeeApplied,
        uint256 _feePerPeriod
    ) internal virtual {
        require(lastTimeFeeApplied == 0, "BackedAutoFeeTokenImplementation already initialized");
        require(_lastTimeFeeApplied != 0, "Invalid last time fee applied");

        multiplier = 1e18;
        multiplierNonce = 0;
        periodLength = _periodLength;
        lastTimeFeeApplied = _lastTimeFeeApplied;
        feePerPeriod = _feePerPeriod;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        (uint256 newMultiplier, ,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(_totalShares, newMultiplier);
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(
        address account
    ) public view virtual override returns (uint256) {
        (uint256 newMultiplier, ,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(sharesOf(account), newMultiplier);
    }

    /**
     * @dev Retrieves most up to date value of multiplier
     *
     */
    function getCurrentMultiplier()
        public
        view
        virtual
        returns (uint256 newMultiplier, uint256 periodsPassed, uint256 newMultiplierNonce)
    {
        periodsPassed = (block.timestamp - lastTimeFeeApplied) / periodLength;
        newMultiplier = multiplier;
        newMultiplierNonce = multiplierNonce;
        if (feePerPeriod > 0) {
            for (uint256 index = 0; index < periodsPassed; index++) {
                newMultiplier = (newMultiplier * (1e18 - feePerPeriod)) / 1e18;
            }
            newMultiplierNonce += periodsPassed;
        }
    }

    /**
     * @dev Returns amount of shares owned by given account
     */
    function sharesOf(address account) public view virtual returns (uint256) {
        return _shares[account];
    }

    /**
     * @return the amount of shares that corresponds to `_underlyingAmount` underlying amount.
     */
    function getSharesByUnderlyingAmount(
        uint256 _underlyingAmount
    ) external view returns (uint256) {
        (uint256 newMultiplier, ,) = getCurrentMultiplier();
        return _getSharesByUnderlyingAmount(_underlyingAmount, newMultiplier);
    }

    /**
     * @return the amount of underlying that corresponds to `_sharesAmount` token shares.
     */
    function getUnderlyingAmountByShares(
        uint256 _sharesAmount
    ) external view returns (uint256) {
        (uint256 newMultiplier, ,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(_sharesAmount, newMultiplier);
    }

    /**
     * @dev Delegated Transfer Shares, transfer shares via a sign message, using erc712.
     */
    function delegatedTransferShares(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual allowedDelegate updateMultiplier {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATED_TRANSFER_SHARES_TYPEHASH,
                owner,
                to,
                value,
                _useNonce(owner),
                deadline
            )
        );
        _checkOwner(owner, structHash, v, r, s);

        uint256 amount = _getUnderlyingAmountByShares(value, multiplier);
        _transfer(owner, to, amount);
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
    ) external virtual updateMultiplier returns (bool) {
        address owner = _msgSender();
        uint256 amount = _getUnderlyingAmountByShares(sharesAmount, multiplier);
        _transfer(owner, to, amount);
        return true;
    }

    /**
     * @dev Function to set the new fee. Allowed only for owner
     *
     * @param newFeePerPeriod The new fee per period value
     */
    function updateFeePerPeriod(
        uint256 newFeePerPeriod
    ) external onlyOwner updateMultiplier {
        feePerPeriod = newFeePerPeriod;
    }

    /**
     * @dev Function to change the contract multiplier updater. Allowed only for owner
     *
     * Emits a { NewMultiplierUpdater } event
     *
     * @param newMultiplierUpdater The address of the new multiplier updater
     */
    function setMultiplierUpdater(
        address newMultiplierUpdater
    ) external onlyOwner {
        multiplierUpdater = newMultiplierUpdater;
        emit NewMultiplierUpdater(newMultiplierUpdater);
    }

    /**
     * @dev Function to change the time of last fee accrual. Allowed only for owner
     *
     * @param newLastTimeFeeApplied A timestamp of last time fee was applied
     */
    function setLastTimeFeeApplied(
        uint256 newLastTimeFeeApplied
    ) external onlyOwner updateMultiplier {
        require(newLastTimeFeeApplied != 0, "Invalid last time fee applied");
        lastTimeFeeApplied = newLastTimeFeeApplied;
    }

    /**
     * @dev Function to change period length. Allowed only for owner
     *
     * @param newPeriodLength Length of a single accrual period in seconds
     */
    function setPeriodLength(uint256 newPeriodLength) external onlyOwner updateMultiplier {
        periodLength = newPeriodLength;
    }

    /**
     * @dev Function to change the contract multiplier, only if oldMultiplier did not change in the meantime. Allowed only for multiplierUpdater
     *
     * Emits a { MultiplierChanged } event
     *
     * @param newMultiplier New multiplier value
     */
    function updateMultiplierValue(
        uint256 newMultiplier,
        uint256 oldMultiplier
    ) public onlyMultiplierUpdater updateMultiplier onlyUpdatedMultiplier(oldMultiplier) {
        _updateMultiplier(newMultiplier, multiplierNonce + 1);
    }

    /**
     * @dev Function to change the contract multiplier with nonce, only if oldMultiplier did not change in the meantime. Allowed only for multiplierUpdater
     *
     * Emits a { MultiplierChanged } event
     *
     * @param newMultiplier New multiplier value
     * @param newMultiplierNonce New multplier nonce
     */
    function updateMultiplierWithNonce(
        uint256 newMultiplier,
        uint256 oldMultiplier,
        uint256 newMultiplierNonce
    ) external onlyMultiplierUpdater updateMultiplier onlyUpdatedMultiplier(oldMultiplier) onlyNewerMultiplierNonce(newMultiplierNonce){
        _updateMultiplier(newMultiplier, newMultiplierNonce);
    }

    /**
     * @return the amount of shares that corresponds to `_underlyingAmount` underlying amount.
     */
    function _getSharesByUnderlyingAmount(
        uint256 _underlyingAmount,
        uint256 _multiplier
    ) internal pure returns (uint256) {
        return (_underlyingAmount * 1e18) / _multiplier;
    }

    /**
     * @return the amount of underlying that corresponds to `_sharesAmount` token shares.
     */
    function _getUnderlyingAmountByShares(
        uint256 _sharesAmount,
        uint256 _multiplier
    ) internal pure returns (uint256) {
        return (_sharesAmount * _multiplier) / 1e18;
    }

    /**
     * @dev Moves `amount` of tokens from `sender` to `recipient`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     * Emits a {TransferShares} event.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     */
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(from, to, amount);
        uint256 _sharesAmount = _getSharesByUnderlyingAmount(
            amount,
            multiplier
        );

        uint256 currentSenderShares = _shares[from];
        require(
            currentSenderShares >= _sharesAmount,
            "ERC20: transfer amount exceeds balance"
        );

        unchecked {
            _shares[from] = currentSenderShares - (_sharesAmount);
        }
        _shares[to] = _shares[to] + (_sharesAmount);

        emit Transfer(from, to, amount);
        emit TransferShares(from, to, _sharesAmount);

        _afterTokenTransfer(from, to, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     * Emits a {TransferShares} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual override {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);
        uint256 sharesAmount = _getSharesByUnderlyingAmount(amount, multiplier);

        _totalShares += sharesAmount;
        _shares[account] += sharesAmount;
        emit Transfer(address(0), account, amount);
        emit TransferShares(address(0), account, sharesAmount);

        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     * Emits a {TransferShares} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `sharesAmount` token shares.
     */
    function _burn(address account, uint256 amount) internal virtual override {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);
        uint256 sharesAmount = _getSharesByUnderlyingAmount(amount, multiplier);

        uint256 accountBalance = _shares[account];
        require(
            accountBalance >= sharesAmount,
            "ERC20: burn amount exceeds balance"
        );
        unchecked {
            _shares[account] = accountBalance - sharesAmount;
        }
        _totalShares -= sharesAmount;

        emit Transfer(account, address(0), amount);
        emit TransferShares(account, address(0), sharesAmount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /**
     * @dev Updates currently stored multiplier with a new value
     *
     * Emit an {MultiplierUpdated} event.
     */
    function _updateMultiplier(uint256 newMultiplier, uint256 newMultiplierNonce) internal virtual {
        multiplier = newMultiplier;
        multiplierNonce = newMultiplierNonce;
        emit MultiplierUpdated(newMultiplier);
    }

    // Implement the update multiplier functionality before transfer:
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override updateMultiplier {
        super._beforeTokenTransfer(from, to, amount);
    }
}
