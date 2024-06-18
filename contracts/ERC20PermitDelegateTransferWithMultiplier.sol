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
pragma solidity 0.8.9;

import "./ERC20UpgradeableWithMultiplier.sol";

/**
 * @dev 
 *
 * This contract is a based (copy-paste with changes) on OpenZeppelin's draft-ERC20Permit.sol (token/ERC20/extensions/draft-ERC20Permit.sol).
 * 
 * The changes are:
 *  - Adding also delegated transfer functionality, that is similar to permit, but doing the actual transfer and not approval.
 *  - Cutting some of the generalities to make the contacts more straight forward for this case (e.g. removing the counters library). 
 *
*/

contract ERC20PermitDelegateTransferWithMultiplier is ERC20UpgradeableWithMultiplier {

    // Calculating the Delegated Transfer Shares typehash:
    bytes32 public constant DELEGATED_TRANSFER_SHARES_TYPEHASH =
        keccak256("DELEGATED_TRANSFER_SHARES(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)");

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
    ) public virtual {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");
        
        bytes32 structHash = keccak256(abi.encode(DELEGATED_TRANSFER_SHARES_TYPEHASH, owner, to, value, _useNonce(owner), deadline));
        _checkOwner(owner, structHash, v, r, s);

        _transferShares(owner, to, value);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
