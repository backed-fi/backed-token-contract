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
    uint256 public lastMultiplier;

    mapping(address => uint256) private _shares;

    uint256 internal _totalShares;

    // Field marked as deprecated as of V3, kept for storage layout compatibility:
    uint256 private multiplierNonce_unused;

    // Fields supporting future multiplier activation time:

    // New multiplier update factor value, in 1e18 precision:
    uint256 public newMultiplierUpdate;
    // Activation time for new multiplier update, zero means no pending update:
    uint256 public newMultiplierActivationTime;

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
        (uint256 currentMultiplier, uint256 periodsPassed, bool didMultiplierUpdateExecuted) = getCurrentMultiplier();
        lastTimeFeeApplied = lastTimeFeeApplied + periodLength * periodsPassed;
        if (lastMultiplier != currentMultiplier) {
            _updateMultiplier(currentMultiplier, didMultiplierUpdateExecuted);
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
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        require(
            currentMultiplier == oldMultiplier,
            "BackedToken: Multiplier changed in the meantime"
        );
        _;
    }
    
    // constructor, set lastTimeFeeApplied and newMultiplierUpdate to lock the implementation instance.
    constructor () {
        lastTimeFeeApplied = 1;
        newMultiplierUpdate = 1e18;
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

    function initialize_v3(
    ) external virtual {
        require(newMultiplierUpdate == 0, "BackedAutoFeeTokenImplementation v3 already initialized");
        newMultiplierUpdate = 1e18;
        newMultiplierActivationTime = 0;
    }

    function _initialize_auto_fee(
        uint256 _periodLength,
        uint256 _lastTimeFeeApplied,
        uint256 _feePerPeriod
    ) internal virtual {
        require(lastTimeFeeApplied == 0, "BackedAutoFeeTokenImplementation already initialized");
        require(_lastTimeFeeApplied != 0, "Invalid last time fee applied");

        lastMultiplier = 1e18;
        newMultiplierUpdate = 1e18;
        newMultiplierActivationTime = 0;
        periodLength = _periodLength;
        lastTimeFeeApplied = _lastTimeFeeApplied;
        feePerPeriod = _feePerPeriod;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(_totalShares, currentMultiplier);
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(
        address account
    ) public view virtual override returns (uint256) {
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(sharesOf(account), currentMultiplier);
    }

    /**
     * @dev Returns most up to date value of multiplier
     *
     */
    function multiplier() external view returns (uint256) {
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        return currentMultiplier;
    }

    /**
     * @dev Retrieves most up to date value of multiplier
     *
     */
    function getCurrentMultiplier()
        public
        view
        virtual
        returns (uint256 currentMultiplier, uint256 periodsPassed, bool didMultiplierUpdateExecuted)
    {
        // Start from last known multiplier:
        currentMultiplier = lastMultiplier;
        didMultiplierUpdateExecuted = false;
        
        // Apply pending multiplier update if activation time has passed:
        if(newMultiplierActivationTime != 0 && newMultiplierActivationTime <= block.timestamp) {
            currentMultiplier = (currentMultiplier * newMultiplierUpdate) / 1e18;
            didMultiplierUpdateExecuted = true;
        }
        
        // Apply fee components:
        periodsPassed = (block.timestamp - lastTimeFeeApplied) / periodLength;
        if (feePerPeriod > 0) {
            for (uint256 index = 0; index < periodsPassed; index++) {
                currentMultiplier = (currentMultiplier * (1e18 - feePerPeriod)) / 1e18;
            }
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
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        return _getSharesByUnderlyingAmount(_underlyingAmount, currentMultiplier);
    }

    /**
     * @return the amount of underlying that corresponds to `_sharesAmount` token shares.
     */
    function getUnderlyingAmountByShares(
        uint256 _sharesAmount
    ) external view returns (uint256) {
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        return _getUnderlyingAmountByShares(_sharesAmount, currentMultiplier);
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

        _transferShares(owner, to, value);
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
        _transferShares(owner, to, sharesAmount);

        return true;
    }

    /**
     * @dev Transfers underlying shares from source account to destination account
     *
     * Requirements:
     *
     * - `from` cannot be the zero address and caller needs to have permission to use it's allowance.
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `sharesAmount`.
     */
    function transferSharesFrom(
        address from,
        address to,
        uint256 sharesAmount
    ) external virtual updateMultiplier returns (bool) {
        uint256 amount = _getUnderlyingAmountByShares(sharesAmount, lastMultiplier);
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transferShares(from, to, sharesAmount, amount);
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
        require(newMultiplierActivationTime == 0, "Multiplier activation in progress");
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
        require(newMultiplierActivationTime == 0, "Multiplier activation in progress");
        require(newLastTimeFeeApplied != 0, "Invalid last time fee applied");
        lastTimeFeeApplied = newLastTimeFeeApplied;
    }

    /**
     * @dev Function to change period length. Allowed only for owner
     *
     * @param newPeriodLength Length of a single accrual period in seconds
     */
    function setPeriodLength(uint256 newPeriodLength) external onlyOwner updateMultiplier {
        require(newMultiplierActivationTime == 0, "Multiplier activation in progress");
        periodLength = newPeriodLength;
    }

    /**
     * @dev Function to change the contract multiplier, only if oldMultiplier did not change in the meantime.
     * 
     * Allowed only for multiplierUpdater
     *
     * Emits a { MultiplierChanged } event
     *
     * @param pendingNewMultiplier New multiplier value
     * @param oldMultiplier Old multiplier value
     */
    function updateMultiplierValue(
        uint256 pendingNewMultiplier,
        uint256 oldMultiplier
    ) public onlyMultiplierUpdater updateMultiplier onlyUpdatedMultiplier(oldMultiplier) {
        _updateMultiplier(pendingNewMultiplier, false);
    }

    /**
     * @dev Function to schedule multiplier update.
     * It expects an activation time for the new multiplier update, which can be set in the future for future activation,
     * or in the past to activate immediately. It follows similar approach as SPL Token2022 Scaled UI Extension.
     * 
     * Allowed only for multiplierUpdater
     *
     * Emits a { MultiplierChanged } event
     *
     * @param relativeMultiplierUpdate New multiplier change expressed as relative change in 1e18 precision
     * @param pendingNewMultiplierUpdateActivationTime Time when new multiplier change becomes active
     */
    function scheduleMultiplierUpdate(
        uint256 relativeMultiplierUpdate,
        uint256 pendingNewMultiplierUpdateActivationTime
    ) public onlyMultiplierUpdater updateMultiplier {
        require(relativeMultiplierUpdate != 0, "BackedToken: Relative multiplier update cannot be zero");

        // If activation time is in the past or now, apply immediately:
        if(pendingNewMultiplierUpdateActivationTime <= block.timestamp) {
            lastMultiplier = (lastMultiplier * relativeMultiplierUpdate) / 1e18;
            emit MultiplierUpdated(lastMultiplier);
        } else {
            // Schedule for future activation:
            newMultiplierActivationTime = pendingNewMultiplierUpdateActivationTime;
            newMultiplierUpdate = relativeMultiplierUpdate;
        }
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
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        uint256 _sharesAmount = _getSharesByUnderlyingAmount(
            amount,
            currentMultiplier
        );
        _transferShares(from, to, _sharesAmount, amount);
    }

    /**
     * @dev Moves `shares amount` of tokens from `sender` to `recipient`.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `from` must have a balance of at least `sharesAmount`.
     */
    function _transferShares(
        address from,
        address to,
        uint256 sharesAmount
    ) internal virtual {
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
         uint256 amount = _getUnderlyingAmountByShares(
            sharesAmount,
            currentMultiplier
        );
        _transferShares(from, to, sharesAmount, amount);
    }
    
    /**
     * @dev Moves `shares amount` of tokens from `sender` to `recipient`.
     *
     * Emits a {Transfer} event.
     * Emits a {TransferShares} event.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `from` must have a balance of at least `sharesAmount`.
     */
    function _transferShares(
        address from,
        address to,
        uint256 sharesAmount,
        uint256 tokenAmount
    ) internal virtual {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(from, to, tokenAmount);

        uint256 currentSenderShares = _shares[from];
        require(
            currentSenderShares >= sharesAmount,
            "ERC20: transfer amount exceeds balance"
        );

        unchecked {
            _shares[from] = currentSenderShares - (sharesAmount);
        }
        _shares[to] = _shares[to] + (sharesAmount);

        emit Transfer(from, to, tokenAmount);
        emit TransferShares(from, to, sharesAmount);

        _afterTokenTransfer(from, to, tokenAmount);
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
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        uint256 sharesAmount = _getSharesByUnderlyingAmount(amount, currentMultiplier);

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
        (uint256 currentMultiplier,,) = getCurrentMultiplier();
        uint256 sharesAmount = _getSharesByUnderlyingAmount(amount, currentMultiplier);

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
     * 
     * @param pendingNewMultiplier New multiplier value
     * @param didMultiplierUpdateExecuted Whether the multiplier update was executed now
     * 
     */
    function _updateMultiplier(uint256 pendingNewMultiplier, bool didMultiplierUpdateExecuted) internal virtual {
        require(pendingNewMultiplier != 0, "BackedToken: Multiplier cannot be zero");

        lastMultiplier = pendingNewMultiplier;

        // Clear pending update if it was executed:
        if(didMultiplierUpdateExecuted) {
            newMultiplierUpdate = 1e18; // Denotes no change
            newMultiplierActivationTime = 0;
        }
        
        emit MultiplierUpdated(pendingNewMultiplier);
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
