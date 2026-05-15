// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../SanctionsList.sol";
import "./IBackedToken.sol";

/**
 * @title IBackedAutoFeeToken
 * @dev Interface for the BackedAutoFeeToken, a rebasing ERC20 token with automatic fee accrual
 *
 * This token implements a share-based rebasing mechanism where:
 * - Users hold shares that represent their portion of the total supply
 * - A multiplier converts shares to underlying token amounts
 * - Fees are automatically applied by decreasing the multiplier over time
 * - The multiplier can be updated by an authorized multiplierUpdater address
 */
interface IBackedAutoFeeToken is IBackedToken {

    // View functions - EIP-712 and Roles

    /**
     * @dev Returns the address authorized to update the multiplier
     * @return The multiplier updater address
     */
    function multiplierUpdater() external view returns (address);

    // View functions - Fee Configuration

    /**
     * @dev Returns the timestamp when the fee was last applied
     * @return The Unix timestamp of the last fee application
     */
    function lastTimeFeeApplied() external view returns (uint256);

    /**
     * @dev Returns the fee rate applied per period
     * @return The fee per period in 1e18 precision (e.g., 1e15 = 0.1% fee)
     */
    function feePerPeriod() external view returns (uint256);

    /**
     * @dev Returns the length of each fee accrual period in seconds
     * @return The period length in seconds (e.g., 86400 for daily fees)
     */
    function periodLength() external view returns (uint256);

    // View functions - Multiplier State

    /**
     * @dev Returns the last activated multiplier value
     * @return The last multiplier value in 1e18 precision
     */
    function lastMultiplier() external view returns (uint256);

    /**
     * @dev Returns the current active multiplier, considering pending activations
     * @return The currently active multiplier value in 1e18 precision
     */
    function multiplier() external view returns (uint256);

    /**
     * @dev Returns the nonce of the last activated multiplier
     * @return The last multiplier nonce
     */
    function lastMultiplierNonce() external view returns (uint256);

    /**
     * @dev Returns the nonce of the pending/new multiplier
     * @return The new multiplier nonce
     */
    function newMultiplierNonce() external view returns (uint256);

    /**
     * @dev Returns the value of the pending/new multiplier
     * @return The new multiplier value in 1e18 precision
     */
    function newMultiplier() external view returns (uint256);

    /**
     * @dev Returns the timestamp when the new multiplier becomes active
     * @return The Unix timestamp of activation (0 if no pending activation)
     */
    function newMultiplierActivationTime() external view returns (uint256);

    /**
     * @dev Returns the current multiplier nonce, considering pending activations
     * @return The current active multiplier nonce
     */
    function multiplierNonce() external view returns (uint256);

    /**
     * @dev Calculates and returns the current multiplier with fees applied
     * @return currentMultiplier The multiplier value with all accrued fees applied
     * @return periodsPassed The number of fee periods that have passed
     * @return currentMultiplierNonce The nonce including periods passed
     */
    function getCurrentMultiplier() external view returns (uint256 currentMultiplier, uint256 periodsPassed, uint256 currentMultiplierNonce);

    // View functions - Token Shares

    /**
     * @dev Returns the share balance of an account
     * @param account The address to query
     * @return The number of shares owned by the account
     */
    function sharesOf(address account) external view returns (uint256);

    /**
     * @dev Converts an underlying token amount to shares
     * @param _underlyingAmount The amount of tokens to convert
     * @return The equivalent amount of shares
     */
    function getSharesByUnderlyingAmount(uint256 _underlyingAmount) external view returns (uint256);

    /**
     * @dev Converts shares to underlying token amount
     * @param _sharesAmount The amount of shares to convert
     * @return The equivalent amount of tokens
     */
    function getUnderlyingAmountByShares(uint256 _sharesAmount) external view returns (uint256);

    // State-changing functions - Share Transfers

    /**
     * @dev Executes a delegated share transfer using EIP-712 signature
     * @param owner The address that owns the shares
     * @param to The address to transfer shares to
     * @param value The amount of shares to transfer
     * @param deadline The deadline timestamp for the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function delegatedTransferShares(address owner, address to, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    /**
     * @dev Transfers shares from the caller to another address
     * @param to The address to transfer shares to
     * @param sharesAmount The amount of shares to transfer
     * @return success True if the transfer succeeded
     */
    function transferShares(address to, uint256 sharesAmount) external returns (bool);

    /**
     * @dev Transfers shares from one address to another using allowance
     * @param from The address to transfer shares from
     * @param to The address to transfer shares to
     * @param sharesAmount The amount of shares to transfer
     * @return success True if the transfer succeeded
     */
    function transferSharesFrom(address from, address to, uint256 sharesAmount) external returns (bool);

    // State-changing functions - Fee Configuration (Owner only)

    /**
     * @dev Updates the fee rate per period
     * Can only be called by the owner
     * Cannot be called when a multiplier activation is pending
     * @param newFeePerPeriod The new fee rate in 1e18 precision
     */
    function updateFeePerPeriod(uint256 newFeePerPeriod) external;

    /**
     * @dev Updates the multiplier updater address
     * Can only be called by the owner
     * @param newMultiplierUpdater The address of the new multiplier updater
     */
    function setMultiplierUpdater(address newMultiplierUpdater) external;

    /**
     * @dev Updates the timestamp of last fee application
     * Can only be called by the owner
     * Cannot be called when a multiplier activation is pending
     * @param newLastTimeFeeApplied The new timestamp (must be non-zero)
     */
    function setLastTimeFeeApplied(uint256 newLastTimeFeeApplied) external;

    /**
     * @dev Updates the length of each fee period
     * Can only be called by the owner
     * Cannot be called when a multiplier activation is pending
     * @param newPeriodLength The new period length in seconds
     */
    function setPeriodLength(uint256 newPeriodLength) external;

    // State-changing functions - Multiplier Updates (Multiplier Updater only)

    /**
     * @dev Updates the multiplier value with automatic nonce increment
     * Can only be called by the multiplier updater
     * Validates that the oldMultiplier matches the current value
     * @param pendingNewMultiplier The new multiplier value in 1e18 precision
     * @param oldMultiplier The expected current multiplier for validation
     * @param pendingNewMultiplierActivationTime When to activate (0 for immediate, future timestamp for delayed)
     */
    function updateMultiplierValue(uint256 pendingNewMultiplier, uint256 oldMultiplier, uint256 pendingNewMultiplierActivationTime) external;

    /**
     * @dev Updates the multiplier value with explicit nonce
     * Can only be called by the multiplier updater
     * Validates that the oldMultiplier matches and nonce is newer
     * @param newMultiplier The new multiplier value in 1e18 precision
     * @param oldMultiplier The expected current multiplier for validation
     * @param newMultiplierNonce The explicit nonce for this update
     * @param pendingNewMultiplierActivationTime When to activate (0 for immediate, future timestamp for delayed)
     */
    function updateMultiplierWithNonce(uint256 newMultiplier, uint256 oldMultiplier, uint256 newMultiplierNonce, uint256 pendingNewMultiplierActivationTime) external;
}