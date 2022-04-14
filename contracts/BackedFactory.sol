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

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "./BackedTokenImplementation.sol";

contract BackedFactory is Ownable {
    ProxyAdmin public proxyAdmin;
    BackedTokenImplementation public tokenImplementation;

    mapping(address => bool) public deployedTokens;

    event NewToken(address indexed newToken);

    constructor (address proxyAdminOwner) {
        tokenImplementation = new BackedTokenImplementation();
        proxyAdmin = new ProxyAdmin();
        proxyAdmin.transferOwnership(proxyAdminOwner);
    }

    function deployToken(string memory name, string memory symbol, address tokenOwner, address minter, address burner, address pauser) external onlyOwner returns (address) {
        require(tokenOwner != address(0) && minter != address(0) && burner != address(0) && pauser != address(0),
            "BackedFactory: address should not be 0");

        bytes32 salt = keccak256(abi.encodePacked(name, symbol));

        TransparentUpgradeableProxy newProxy = new TransparentUpgradeableProxy{salt : salt}(
            address(tokenImplementation),
            address(proxyAdmin),
            abi.encodeWithSelector(BackedTokenImplementation(address(0)).initialize.selector, name, symbol)
        );

        BackedTokenImplementation newToken = BackedTokenImplementation(address(newProxy));

        require(!deployedTokens[address(newToken)], "Factory: Shouldn't deploy same address");

        deployedTokens[address(newToken)] = true;

        newToken.setMinter(minter);
        newToken.setBurner(burner);
        newToken.setPauser(pauser);
        newToken.transferOwnership(tokenOwner);

        emit NewToken(address(newToken));

        return (address(newToken));
    }
}