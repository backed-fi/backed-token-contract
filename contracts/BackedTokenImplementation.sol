//SPDX-License-Identifier: ISC
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ERC20PermitDelegateTransfer.sol";

/**
 * @dev
 *
 * This token contract is following the ERC20 standard.
 * It inherits ERC20PermitDelegateTransfer.sol, which extends the basic ERC20 to also allow permit and delegateTransfer ERC712 functionality.
 * The contract contains three roles:
 *  - A minter, that can mint new tokens.
 *  - A burner, that can burn its own tokens, or contract's tokens.
 *  - A pauser, that can pause or restore all transfers in the contract.
 *  - An owner, that can set the three above.
 * The owner can also set who can use the ERC712 functionality, either specific accounts via a whitelist, or everyone.
 * 
 */

contract BackedTokenImplementation is Ownable, ERC20PermitDelegateTransfer {
    // ERC20:
    string private _name;
    string private _symbol;

    // Roles:
    address public minter;
    address public burner;
    address public pauser;

    // ERC712 delegation:
    bool public delegateMode;
    mapping (address=>bool) public delegateWhitelist;

    // Pause:
    bool public isPaused;

    // Initialized:
    bool private _initialized;

    // Events:
    event NewMinter(address indexed newMinter);
    event NewBurner(address indexed newBurner);
    event NewPauser(address indexed newPauser);
    event DelegationWhitelistChange(address indexed whitelistAddress, bool status);
    event DelegationModeChange(bool delegationMode);
    event PauseModeChange(bool pauseMode);
    
    modifier allowedDelegation {
        require(delegateMode || delegateWhitelist[_msgSender()], "BackedToken: Unauthorized delegate");
        _;
    }

    constructor () ERC20PermitDelegateTransfer("Backed Token Implementation", "BTI") {
        initialize("Backed Token Implementation", "BTI");
    }

    function initialize(string memory name_, string memory symbol_) public {
        require(!_initialized, "BackedToken: Already initialized");
        _name = name_;
        _symbol = symbol_;
        _transferOwnership(_msgSender());
        _buildDomainSeparator();
        _initialized = true;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    // Permit, uses super, allowed only if delegationMode is true, or if the relayer is whitelisted:    
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegation {
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    // Delegated Transfer, uses super, allowed only if delegationMode is true, or if the relayer is whitelisted:
    function delegatedTransfer(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override allowedDelegation {
        super.delegatedTransfer(owner, to, value, deadline, v, r, s);
    }

    // Mint new tokens, only allowed for minter:
    function mint(address account, uint256 amount) public {
        require(_msgSender() == minter, "BackedToken: Only minter");
        _mint(account, amount);
    }

    // Burn tokens from msg.sender account, or from the contract itself. Only allowed for burner:
    function burn(address account, uint256 amount) public {
        require(_msgSender() == burner, "BackedToken: Only burner");
        require(account == _msgSender() || account == address(this), "BackedToken: Cannot burn account");
        _burn(account, amount);
    }

    // Set pause, to block or restore all transfers. Only allowed for pauser:
    function setPause(bool newPauseMode) public {
        require(_msgSender() == pauser, "BackedToken: Only pauser");
        isPaused = newPauseMode;
        emit PauseModeChange(newPauseMode);
    }

    // Set minter, only owner:
    function setMinter(address newMinter) public onlyOwner {
        minter = newMinter;
        emit NewMinter(newMinter);
    }

    // Set burner, only owner:
    function setBurner(address newBurner) public onlyOwner {
        burner = newBurner;
        emit NewBurner(newBurner);
    }

    // Set pauser, only owner:
    function setPauser(address newPauser) public onlyOwner {
        pauser = newPauser;
        emit NewPauser(newPauser);
    }

    // ERC712 set delegation whitelist, only owner:
    function setDelegationWhitelist(address whitelistAddress, bool status) public onlyOwner {
        delegateWhitelist[whitelistAddress] = status;
        emit DelegationWhitelistChange(whitelistAddress, status);
    }

    // ERC712 set delegation mode, only owner:
    function setDelegateMode(bool delegationMode) public onlyOwner {
        delegateMode = delegationMode;
        emit DelegationModeChange(delegationMode);
    }   

    // Implement the pause functionality:
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        require(!isPaused, "BackedToken: token transfer while paused");
    }
}
