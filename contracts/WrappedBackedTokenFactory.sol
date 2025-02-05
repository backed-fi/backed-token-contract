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
import "./WrappedBackedTokenImplementation.sol";

/**
 * @dev
 * TransparentUpgradeableProxy contract, renamed as WrappedBackedTokenProxy.
 */
contract WrappedBackedTokenProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address admin_,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, admin_, _data) {}
}

/**
 * @dev
 *
 * Factory contract, used for creating new, upgradable wrapped tokens.
 *
 * The contract contains one role:
 *  - An owner, which can deploy new tokens
 *
 */
contract WrappedBackedTokenFactory is Ownable {
    ProxyAdmin public immutable proxyAdmin;
    WrappedBackedTokenImplementation public wrappedTokenImplementation;

    event NewToken(address indexed newToken, string name, string symbol);
    event NewImplementation(address indexed newImplementation);

    /**
     * @param proxyAdminOwner The address of the account that will be set as owner of the deployed ProxyAdmin
     */
    constructor(address proxyAdminOwner) {
        require(
            proxyAdminOwner != address(0),
            "Factory: address should not be 0"
        );

        wrappedTokenImplementation = new WrappedBackedTokenImplementation();
        proxyAdmin = new ProxyAdmin();
        proxyAdmin.transferOwnership(proxyAdminOwner);
    }

    struct TokenDeploymentConfiguration {
        string name;                   // The name that the newly created token will have
        string symbol;                 // The symbol that the newly created token will have
        address underlying;            // The address of the wrapped token underlying
        address tokenOwner;            // The address of the account to which the owner role will be assigned
        address pauser;                // The address of the account to which the pauser role will be assigned
        address sanctionsList;         // The address of sanctions list contract
    }

    /**
     * @dev Deploy and configures new instance of Wrapped BackedFi Token. Callable only by the factory owner
     *
     * Emits a { NewToken } event
     *
     * @param configuration      Configuration structure for token deployment
     */
    function deployToken(
        TokenDeploymentConfiguration calldata configuration
    ) external onlyOwner returns (address) {
        require(
            configuration.tokenOwner != address(0) &&
            configuration.underlying != address(0) &&
                configuration.pauser != address(0),
            "Factory: address should not be 0"
        );

        bytes32 salt = keccak256(
            abi.encodePacked(configuration.name, configuration.symbol)
        );

        WrappedBackedTokenProxy newProxy = new WrappedBackedTokenProxy{salt: salt}(
            address(wrappedTokenImplementation),
            address(proxyAdmin),
            abi.encodeWithSelector(
                bytes4(
                    keccak256(
                        "initialize(string,string,address)"
                    )
                ),
                configuration.name,
                configuration.symbol,
                configuration.underlying
            )
        );

        WrappedBackedTokenImplementation newToken = WrappedBackedTokenImplementation(
                address(newProxy)
            );
            
        newToken.setPauser(configuration.pauser);
        newToken.setSanctionsList(configuration.sanctionsList);
        newToken.transferOwnership(configuration.tokenOwner);

        emit NewToken(
            address(newToken),
            configuration.name,
            configuration.symbol
        );

        return (address(newToken));
    }

    /**
     * @dev Update the implementation for future deployments
     *
     * Emits a { NewImplementation } event
     *
     * @param newImplementation     address of the new implementation
     */
    function updateImplementation(
        address newImplementation
    ) external onlyOwner {
        require(
            newImplementation != address(0),
            "Factory: address should not be 0"
        );

        wrappedTokenImplementation = WrappedBackedTokenImplementation(
            newImplementation
        );

        emit NewImplementation(newImplementation);
    }
}
