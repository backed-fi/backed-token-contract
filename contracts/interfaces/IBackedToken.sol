// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../SanctionsList.sol";

/**
 * @title IBackedToken
 * @dev Interface for BackedTokenImplementation, an ERC20 token with EIP-712
 *      permit and delegated-transfer support, role-based mint/burn/pause
 *      controls, a Chainalysis-compatible sanctions list, and a settable
 *      terms-of-service link.
 *
 * The contract exposes four roles:
 *  - minter: can mint new tokens.
 *  - burner: can burn its own tokens or tokens held by the contract itself.
 *  - pauser: can pause or unpause all transfers.
 *  - owner: can configure the three roles above, the sanctions list, the
 *           delegate-mode flags, and the terms string.
 */
interface IBackedToken {
    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);

    // View functions - Roles

    /**
     * @dev Returns the address authorized to mint tokens.
     */
    function minter() external view returns (address);

    /**
     * @dev Returns the address authorized to burn tokens.
     */
    function burner() external view returns (address);

    /**
     * @dev Returns the address authorized to pause/unpause transfers.
     */
    function pauser() external view returns (address);

    // View functions - Delegate Mode

    /**
     * @dev Returns whether anyone is allowed to relay `permit` and
     *      `delegatedTransfer` calls. When false, only addresses present in
     *      `delegateWhitelist` are allowed.
     */
    function delegateMode() external view returns (bool);

    /**
     * @dev Returns whether `account` is whitelisted to relay `permit` and
     *      `delegatedTransfer` calls.
     * @param account The address to query.
     */
    function delegateWhitelist(address account) external view returns (bool);

    // View functions - Pause

    /**
     * @dev Returns whether all token transfers are currently paused.
     */
    function isPaused() external view returns (bool);

    // View functions - Sanctions List and Terms

    /**
     * @dev Returns the sanctions list contract used to gate transfers and
     *      allowance spends. Follows the Chainalysis interface.
     */
    function sanctionsList() external view returns (SanctionsList);

    /**
     * @dev Returns the current terms-of-service string (typically a web or
     *      IPFS link).
     */
    function terms() external view returns (string memory);

    // State-changing functions - Initialization

    /**
     * @dev Initializes the token. Can only be called once per proxy.
     * @param name_   The ERC20 token name.
     * @param symbol_ The ERC20 token symbol.
     */
    function initialize(string memory name_, string memory symbol_) external;

    // State-changing functions - Mint and Burn

    /**
     * @dev Mint new tokens. Callable only by `minter`.
     * @param account Recipient of the minted tokens.
     * @param amount  Amount to mint.
     */
    function mint(address account, uint256 amount) external;

    /**
     * @dev Burn tokens. Callable only by `burner`. The burned tokens must
     *      come from the burner itself or from this contract.
     * @param account Account from which the tokens will be burned.
     * @param amount  Amount to burn.
     */
    function burn(address account, uint256 amount) external;

    // State-changing functions - Pause

    /**
     * @dev Pause or unpause all token transfers. Callable only by `pauser`.
     * @param newPauseMode True to pause, false to resume.
     */
    function setPause(bool newPauseMode) external;

    // State-changing functions - Owner Configuration

    /**
     * @dev Set the address authorized to mint tokens. Owner only.
     * @param newMinter The new minter address.
     */
    function setMinter(address newMinter) external;

    /**
     * @dev Set the address authorized to burn tokens. Owner only.
     * @param newBurner The new burner address.
     */
    function setBurner(address newBurner) external;

    /**
     * @dev Set the address authorized to pause transfers. Owner only.
     * @param newPauser The new pauser address.
     */
    function setPauser(address newPauser) external;

    /**
     * @dev Point the contract at a new sanctions-list contract. Owner only.
     *      The new contract must implement the Chainalysis interface; the
     *      call probes `isSanctioned(address(this))` to verify.
     * @param newSanctionsList The new sanctions list address.
     */
    function setSanctionsList(address newSanctionsList) external;

    /**
     * @dev Toggle the delegate-relay whitelist status of an address. Owner only.
     * @param whitelistAddress The address whose status is changing.
     * @param status           True to whitelist, false to remove.
     */
    function setDelegateWhitelist(address whitelistAddress, bool status) external;

    /**
     * @dev Toggle global delegate mode. When true, anyone may relay `permit`
     *      and `delegatedTransfer` calls. Owner only.
     * @param _delegateMode The new delegate-mode flag.
     */
    function setDelegateMode(bool _delegateMode) external;

    /**
     * @dev Set the terms-of-service string. Owner only.
     * @param newTerms The new terms (typically a web or IPFS link).
     */
    function setTerms(string memory newTerms) external;

    // Events

    event NewMinter(address indexed newMinter);
    event NewBurner(address indexed newBurner);
    event NewPauser(address indexed newPauser);
    event NewSanctionsList(address indexed newSanctionsList);
    event DelegateWhitelistChange(address indexed whitelistAddress, bool status);
    event DelegateModeChange(bool delegateMode);
    event PauseModeChange(bool pauseMode);
    event NewTerms(string newTerms);
}
