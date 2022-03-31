// SPDX-License-Identifier: MIT
// 

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @dev 
 *
 * This contract is a based (copy-paste with changes) on OpenZeppelin's draft-ERC20Permit.sol (token/ERC20/extensions/draft-ERC20Permit.sol).
 * 
 * The changes are:
 *  - Adding also delegated transfer functionality, that is similar to permit, but doing the actual transfer and not approval.
 *  - Cutting some of the generalities to make the contacts more stright forward for this case (e.g. removing the counters library). 
 *
*/

contract ERC20PermitDelegateTransfer is ERC20 {
    mapping(address => uint256) private nonces;

    // Calculating the Permit typehash:
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // Calculating the Delegated Transfer typehash:
    bytes32 public constant DELEGATED_TRANSFER_TYPEHASH =
        keccak256("DELEGATED_TRANSFER(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)");

    // Immutable variable for Domain Separator:
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;

    // A version number:
    string internal constant VERSION = "1";


    /**
     * @dev
     *
     * Calculate the DOMAIN_SEPARATOR structHash:
     */
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _buildDomainSeparator();
    }

    /**
     * @dev Permit, approve via a sign message, using erc712.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));

        bytes32 hash = ECDSA.toTypedDataHash(DOMAIN_SEPARATOR, structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");

        _approve(owner, spender, value);
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
    ) public virtual {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(abi.encode(DELEGATED_TRANSFER_TYPEHASH, owner, to, value, _useNonce(owner), deadline));

        bytes32 hash = ECDSA.toTypedDataHash(DOMAIN_SEPARATOR, structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");

        _transfer(owner, to, value);
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     */
    function _useNonce(address owner) internal virtual returns (uint256 current) {
        current = nonces[owner];
        nonces[owner]++;
    }

    function _buildDomainSeparator() internal {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name())),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }
}
