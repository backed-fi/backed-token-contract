//SPDX-License-Identifier: ISC
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ERC20PermitDelegateTransfer.sol";

contract BackedToken is Ownable, ERC20PermitDelegateTransfer {
    // Roles:
    address public minter;
    address public burner;

    // ERC712 delegation:
    bool public delegateMode;
    mapping (address=>bool) public delegateWhitelist;


    // Events:
    event NewMinter(address indexed newMinter);
    event NewBurner(address indexed newBurner);
    event DelegationWhitelistChange(address indexed whitelistAddress, bool status);
    event DelegationModeChange(bool delegationMode);

    
    modifier allowedDelegation {
        require(delegateMode || delegateWhitelist[_msgSender()], "BackedToken: Unauthorized delegate");
        _;
    }

    constructor (string memory name_, string memory symbol_) ERC20PermitDelegateTransfer(name_, symbol_) {}


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

    // Mint/Burn functionality:
    function mint(address account, uint256 amount) public {
        require(_msgSender() == minter, "BackedToken: Only minter");
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) public {
        require(_msgSender() == burner, "BackedToken: Only burner");
        require(account == _msgSender() || account == address(this), "BackedToken: Cannot burn account");
        _burn(account, amount);
    }

    // Set roles, only owner:
    function setMinter(address newMinter) public onlyOwner {
        require(newMinter != address(0), "BackedToken: Minter cannot be 0");
        minter = newMinter;
        emit NewMinter(newMinter);
    }

    function setBurner(address newBurner) public onlyOwner {
        require(newBurner != address(0), "BackedToken: Burner cannot be 0");
        burner = newBurner;
        emit NewBurner(newBurner);
    }

    // ERC712 delegation status, only owner:
    function setDelegationWhitelist(address whitelistAddress, bool status) public onlyOwner {
        delegateWhitelist[whitelistAddress] = status;
        emit DelegationWhitelistChange(whitelistAddress, status);
    }

    function setDelegateMode(bool delegationMode) public onlyOwner {
        delegateMode = delegationMode;
        emit DelegationModeChange(delegationMode);
    }   

}
