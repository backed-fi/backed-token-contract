/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2021-2025 Backed Finance AG
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
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import "./BackedWrappedOracleForwarder.sol";

contract BackedWrappedOracleForwarderProxy is TransparentUpgradeableProxy {
    constructor(
        address _logic,
        address _admin,
        bytes memory _data
    ) payable TransparentUpgradeableProxy(_logic, _admin, _data) {}
}

/**
 * @title BackedWrappedOracleForwarderFactory
 * @notice This factory deploys upgradeable proxies of `BackedWrappedOracleForwarder`,
 *         governed by a ProxyAdmin + TimelockController, similar to BackedOracleFactory.
 */
contract BackedWrappedOracleForwarderFactory is Ownable {
    /// @dev The ProxyAdmin used for controlling upgradeable proxies.
    ProxyAdmin public proxyAdmin;

    /// @dev Timelock for secure upgrade operations.
    TimelockController public timelockController;

    /// @dev The reference implementation for BackedWrappedOracleForwarder.
    BackedWrappedOracleForwarder public implementation;

    /// @notice Emitted whenever a new forwarder proxy is deployed.
    event NewWrappedOracleForwarder(address indexed newForwarder);

    /// @notice Emitted when the implementation reference is updated.
    event NewImplementation(address indexed newImplementation);

    /**
     * @param admin The address with timelock-admin privileges.
     * @param timelockWorkers The addresses given the executor/proposer roles in the timelock.
     */
    constructor(address admin, address[] memory timelockWorkers) {
        require(admin != address(0), "Factory: admin cannot be 0");

        // 1) Deploy the reference implementation.
        implementation = new BackedWrappedOracleForwarder();

        // 2) Deploy a ProxyAdmin
        proxyAdmin = new ProxyAdmin();

        // 3) Deploy a TimelockController (7-day delay as an example).
        timelockController = new TimelockController(
            7 days,
            timelockWorkers,
            timelockWorkers
        );

        // 4) Transfer ProxyAdmin ownership to Timelock, so upgrades are timelocked.
        proxyAdmin.transferOwnership(address(timelockController));

        // 5) Grant the admin address the TIMELOCK_ADMIN_ROLE on the timelock.
        timelockController.grantRole(
            timelockController.TIMELOCK_ADMIN_ROLE(),
            admin
        );
    }

    /**
     * @notice Deploys a new BackedWrappedOracleForwarder proxy, with initialization.
     * @param upstreamOracle The address of the aggregator that gives the underlying asset price.
     * @param wrappedBackedToken The address of the ERC4626 token whose share price we want.
     * @param description A string used for generating a deterministic salt (optional).
     * @return The address of the newly deployed proxy, which acts as the aggregator feed.
     */
    function deployWrappedOracleForwarder(
        address upstreamOracle,
        address wrappedBackedToken,
        string memory description
    ) external onlyOwner returns (address) {
        require(upstreamOracle != address(0), "Invalid upstream oracle");
        require(wrappedBackedToken != address(0), "Invalid wrapped token");

        // Example: use a salt based on the description so repeated calls with the same
        // description cause a “Salt already used” error unless you change something.
        bytes32 salt = keccak256(abi.encodePacked(description));

        // 1) Deploy a new TransparentUpgradeableProxy using our reference `implementation`.
        BackedWrappedOracleForwarderProxy proxy = new BackedWrappedOracleForwarderProxy{
            salt: salt
        }(
            address(implementation),
            address(proxyAdmin),
            abi.encodeWithSelector(
                BackedWrappedOracleForwarder(address(0)).initialize.selector,
                upstreamOracle,
                wrappedBackedToken,
                address(timelockController) // set the timelock as the owner, or pass another if you prefer
            )
        );

        // 2) Emit event for discovery.
        emit NewWrappedOracleForwarder(address(proxy));
        return address(proxy);
    }

    /**
     * @notice Update the stored reference implementation, used for future deployments only.
     * @param newImplementation The new BackedWrappedOracleForwarder implementation contract address.
     */
    function updateImplementation(
        address newImplementation
    ) external onlyOwner {
        require(
            newImplementation != address(0),
            "Factory: newImplementation = 0"
        );
        implementation = BackedWrappedOracleForwarder(newImplementation);

        emit NewImplementation(newImplementation);
    }
}
