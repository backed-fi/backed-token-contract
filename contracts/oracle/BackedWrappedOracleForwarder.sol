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

import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

import "@openzeppelin/contracts-upgradeable-new/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable-new/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable-new/access/OwnableUpgradeable.sol";

import "./BackedOracleInterface.sol";

/**
 * @title BackedWrappedOracleForwarder
 * @notice This contract:
 *         1) Pulls the price of the underlying asset from an upstream oracle.
 *         2) Fetches the assets-per-share ratio from a WrappedBackedToken (ERC4626).
 *         3) Returns the price of 1 share of the WrappedBackedToken, in the same
 *            "currency" (and decimal format) as the upstream oracle feed.
 *
 *         It implements the AggregatorV2V3Interface so that clients reading from
 *         a chainlink-style price feed can treat it like any normal aggregator.
 *
 *         This is an upgradeable contract using Transparent Upgradeable Proxy.
 */
contract BackedWrappedOracleForwarder is
    Initializable,
    OwnableUpgradeable,
    AggregatorV2V3Interface
{
    // ========== Storage ==========

    /// @dev The upstream oracle that provides the underlying price feed.
    AggregatorV2V3Interface public _upstreamOracle;

    /// @dev The wrapped token implementing ERC4626, from which we get assets/share.
    ERC4626Upgradeable public _wrappedBackedToken;

    // ========== Initializer ==========

    /**
     * @notice Initialize the upgradeable contract.
     * @param upstreamOracle Address of the aggregator that gives the underlying asset price.
     * @param wrappedBackedToken Address of the ERC4626 token whose share price we want to calculate.
     * @param owner Address of the contract owner.
     */
    function initialize(
        address upstreamOracle,
        address wrappedBackedToken,
        address owner
    ) external initializer {
        __Ownable_init();
        _transferOwnership(owner);

        require(upstreamOracle != address(0), "Invalid upstream oracle");
        require(wrappedBackedToken != address(0), "Invalid wrapped token");

        _upstreamOracle = AggregatorV2V3Interface(upstreamOracle);
        _wrappedBackedToken = ERC4626Upgradeable(wrappedBackedToken);
    }

    // ========== Oracle getters (AggregatorV2V3Interface) ==========

    function version() external view override returns (uint256) {
        return _upstreamOracle.version();
    }

    function decimals() external view override returns (uint8) {
        return _upstreamOracle.decimals();
    }

    function description() external view override returns (string memory) {
        return _upstreamOracle.description();
    }

    /**
     * @notice Get the price of 1 share of the wrapped token, using *current* ratio.
     */
    function latestAnswer() external view override returns (int256) {
        return _calcWrappedPrice(_upstreamOracle.latestAnswer());
    }

    function latestTimestamp() external view override returns (uint256) {
        return _upstreamOracle.latestTimestamp();
    }

    function latestRound() external view override returns (uint256) {
        return _upstreamOracle.latestRound();
    }

    function getTimestamp(
        uint256 roundId
    ) external view override returns (uint256) {
        return _upstreamOracle.getTimestamp(roundId);
    }

    /**
     * @notice Now we actually use roundId to get a *historical* underlying price. We still multiply by
     *         the *current* ratio from ERC4626.
     */
    function getAnswer(
        uint256 roundId
    ) external view override returns (int256) {
        int256 historicalUnderlying = _upstreamOracle.getAnswer(roundId);

        // If there's no historical data, aggregator might return 0
        if (historicalUnderlying <= 0) {
            // Decide how you want to handle no data. Return 0 or revert?
            return 0; // or revert("No data in that round");
        }

        // Multiply that historical underlying price by the *current* ratio
        return _calcWrappedPrice(historicalUnderlying);
    }

    function getRoundData(
        uint80 _roundId
    )
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        // We skip the aggregator's second returned value (which is 'answer') with a comma.
        (roundId, , startedAt, updatedAt, answeredInRound) = _upstreamOracle
            .getRoundData(_roundId);

        // We compute a *current ratio* based price, ignoring any historical ratio
        int256 historicalUnderlying = _upstreamOracle.getAnswer(_roundId);
        int256 wrappedPrice = (historicalUnderlying <= 0)
            ? int256(0)
            : _calcWrappedPrice(historicalUnderlying);

        return (roundId, wrappedPrice, startedAt, updatedAt, answeredInRound);
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        (roundId, , startedAt, updatedAt, answeredInRound) = _upstreamOracle
            .latestRoundData();

        int256 underlying = _upstreamOracle.latestAnswer();
        int256 wrappedPrice = _calcWrappedPrice(underlying);

        return (roundId, wrappedPrice, startedAt, updatedAt, answeredInRound);
    }

    // ========== Owner setters ==========

    function setUpstreamOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        _upstreamOracle = AggregatorV2V3Interface(newOracle);
    }

    function setWrappedBackedToken(address newWrappedToken) external onlyOwner {
        require(newWrappedToken != address(0), "Invalid wrapped token");
        _wrappedBackedToken = ERC4626Upgradeable(newWrappedToken);
    }

    // ========== Internal ==========

    /**
     * @dev Multiply a *given* underlying price by the current share-to-asset ratio.
     *      This is not truly historical if you pass in a historical underlying but
     *      still use the "current" ratio from ERC4626.
     */
    function _calcWrappedPrice(
        int256 underlyingPrice
    ) internal view returns (int256) {
        require(underlyingPrice > 0, "Invalid underlying price");

        // Convert 1 share => underlying assets
        uint8 underlyingTokenDecimals = IERC20MetadataUpgradeable(
            _wrappedBackedToken.asset()
        ).decimals();
        uint8 shareTokenDecimals = _wrappedBackedToken.decimals();

        uint256 oneShare = 10 ** uint256(shareTokenDecimals);
        uint256 assetsPerShare = _wrappedBackedToken.convertToAssets(oneShare);

        // Scale to aggregator’s decimal domain
        int256 scaledAssetsPerShare = int256(assetsPerShare);
        int256 divisor = int256(10 ** uint256(underlyingTokenDecimals));

        return (underlyingPrice * scaledAssetsPerShare) / divisor;
    }
}
