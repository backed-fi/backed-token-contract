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
import "./BackedAutoFeeTokenImplementation.sol";

/**
 * @dev
 * TransparentUpgradeableProxy contract, renamed as BackedTokenProxy.
 */
contract BackedTokenProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address admin_,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, admin_, _data) {}
}

/**
 * @dev
 *
 * Factory contract, used for creating new, upgradable tokens.
 *
 * The contract contains one role:
 *  - An owner, which can deploy new tokens
 *
 */
contract BackedAutoFeeTokenFactory is Ownable {
    ProxyAdmin public proxyAdmin;
    BackedAutoFeeTokenImplementation public tokenImplementation;

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

        tokenImplementation = new BackedAutoFeeTokenImplementation();
        proxyAdmin = new ProxyAdmin();
        proxyAdmin.transferOwnership(proxyAdminOwner);
    }

    struct TokenDeploymentConfiguration {
        string name;                   // The name that the newly created token will have
        string symbol;                 // The symbol that the newly created token will have
        address tokenOwner;            // The address of the account to which the owner role will be assigned
        address minter;                // The address of the account to which the minter role will be assigned
        address burner;                // The address of the account to which the burner role will be assigned
        address pauser;                // The address of the account to which the pauser role will be assigned
        address sanctionsList;         // The address of sanctions list contract
        address multiplierUpdater;     // The address of the account to which the multiplier updater role will be assigned
        uint256 periodLength;          // Length of fee accrual period
        uint256 lastTimeFeeApplied;    // Initial time of fee accrual
        uint256 feePerPeriod;          // Percentage amount of fee accrued every period
    }

    /**
     * @dev Deploy and configures new instance of BackedFi Token. Callable only by the factory owner
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
                configuration.minter != address(0) &&
                configuration.burner != address(0) &&
                configuration.pauser != address(0),
            "Factory: address should not be 0"
        );

        bytes32 salt = keccak256(
            abi.encodePacked(configuration.name, configuration.symbol)
        );

        BackedTokenProxy newProxy = new BackedTokenProxy{salt: salt}(
            address(tokenImplementation),
            address(proxyAdmin),
            abi.encodeWithSelector(
                bytes4(
                    keccak256(
                        "initialize(string,string,uint256,uint256,uint256)"
                    )
                ),
                configuration.name,
                configuration.symbol,
                configuration.periodLength,
                configuration.lastTimeFeeApplied,
                configuration.feePerPeriod
            )
        );

        BackedAutoFeeTokenImplementation newToken = BackedAutoFeeTokenImplementation(
                address(newProxy)
            );

        newToken.setMinter(configuration.minter);
        newToken.setBurner(configuration.burner);
        newToken.setPauser(configuration.pauser);
        newToken.setMultiplierUpdater(configuration.multiplierUpdater);
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

        tokenImplementation = BackedAutoFeeTokenImplementation(
            newImplementation
        );

        emit NewImplementation(newImplementation);
    }
}
