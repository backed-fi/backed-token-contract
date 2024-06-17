// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.5.0) (token/ERC20/ERC20.sol)

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable-new/token/ERC20/ERC20Upgradeable.sol";

/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 * For a generic mechanism see {ERC20PresetMinterPauser}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.zeppelin.solutions/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * We have followed general OpenZeppelin Contracts guidelines: functions revert
 * instead returning `false` on failure. This behavior is nonetheless
 * conventional and does not conflict with the expectations of ERC20
 * applications.
 *
 * Additionally, an {Approval} event is emitted on calls to {transferFrom}.
 * This allows applications to reconstruct the allowance for all accounts just
 * by listening to said events. Other implementations of the EIP may not emit
 * these events, as it isn't required by the specification.
 *
 * Finally, the non-standard {decreaseAllowance} and {increaseAllowance}
 * functions have been added to mitigate the well-known issues around setting
 * allowances. See {IERC20-approve}.
 */
contract ERC20UpgradeableWithMultiplier is ERC20Upgradeable {
    mapping(address => uint256) private _shares;

    uint256 internal _totalShares;

    /**
     * @dev Defines ratio between a single share of a token to balance of a token.
     * Defined in 1e18 precision.
     *
     */
    uint256 private _multiplier;

    /**
     * @dev Emitted when `value` token shares are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event TransferShares(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when multiplier value is updated
     */
    event MultiplierUpdated(uint256 value);

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * The default value of {decimals} is 18. To select a different value for
     * {decimals} you should overload it.
     *
     * All two of these values are immutable: they can only be set once during
     * construction.
     */
    function __Multiplier_init() internal onlyInitializing {
        __Multiplier_init_unchained();
    }

    function __Multiplier_init_unchained() internal onlyInitializing {
        _multiplier = 1e18;
    }
    
    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalShares * _multiplier / 1e18;
    }

    /**
     * @dev Returns ratio of shares to underlying amount in 18 decimals precision
     */
    function multiplier() public view virtual returns (uint256) {
        return _multiplier;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _shares[account] * _multiplier / 1e18;
    }

    /**
     * @dev Returns amount of shares owned by given account
     */
    function sharesOf(address account) public view virtual returns (uint256) {
        return _shares[account];
    }

    /**
     * @dev Transfers underlying shares to destination account
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `sharesAmount`.
     */
    function transferShares(address to, uint256 sharesAmount) public virtual returns (bool) {
        address owner = _msgSender();
        _transferShares(owner, to, sharesAmount);
        return true;
    }

    /**
     * @return the amount of shares that corresponds to `_underlyingAmount` underlying amount.
     */
    function getSharesByUnderlyingAmount(uint256 _underlyingAmount) public view returns (uint256) {
        return _underlyingAmount
             * 1e18
             / _multiplier;
    }

    /**
     * @return the amount of underlying that corresponds to `_sharesAmount` token shares.
     */
    function getUnderlyingAmountByShares(uint256 _sharesAmount) public view returns (uint256) {
        return _sharesAmount
             * _multiplier
             / 1e18;
    }

    /**
     * @notice Moves `_sharesAmount` shares from `from` to `to`.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `from` must hold at least `_sharesAmount` shares.
     * - the contract must not be paused.
     */
    function _transferShares(address from, address to, uint256 _sharesAmount) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        uint256 amount = getUnderlyingAmountByShares(_sharesAmount);
        _beforeTokenTransfer(from, to, amount);

        uint256 currentSenderShares = _shares[from];
        require(currentSenderShares >= _sharesAmount  , "ERC20: transfer amount exceeds balance");

        unchecked {
            _shares[from] = currentSenderShares - (_sharesAmount);
        }
        _shares[to] = _shares[to] + (_sharesAmount);

        emit Transfer(from, to, amount);
        emit TransferShares(from, to, _sharesAmount);
        
        _afterTokenTransfer(from, to, amount);
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
        uint256 _sharesToTransfer = getSharesByUnderlyingAmount(amount);
        _transferShares(from, to, _sharesToTransfer);
    }

    /** @dev Creates `amount` token shares and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     * Emits a {TransferShares} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function _mintShares(address account, uint256 sharesAmount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        uint256 amount = getUnderlyingAmountByShares(sharesAmount);

        _beforeTokenTransfer(address(0), account, amount);

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
    function _burnShares(address account, uint256 sharesAmount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");
        uint256 amount = getUnderlyingAmountByShares(sharesAmount);

        _beforeTokenTransfer(account, address(0), amount);

        uint256 accountBalance = _shares[account];
        require(accountBalance >= sharesAmount, "ERC20: burn amount exceeds balance");
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
    function _updateMultiplier(
        uint256 newMultiplier
    ) internal virtual {
        _multiplier = newMultiplier;
        emit MultiplierUpdated(newMultiplier);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[47] private __gap;
}
