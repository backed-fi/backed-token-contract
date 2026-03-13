// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @dev Mock SanctionsList for testing purposes.
 * Always returns false for isSanctioned — never blocks anyone.
 */
contract MockSanctionsList {
    function isSanctioned(address) external pure returns (bool) {
        return false;
    }
}
