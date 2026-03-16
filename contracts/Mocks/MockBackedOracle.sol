/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2021-2024 Backed Finance AG
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

import "../oracle/BackedOracleInterface.sol";

/**
 * @dev Mock price oracle for hackathon use.
 *
 * Implements AggregatorV2V3Interface (Chainlink-compatible) and computes
 * price automatically on-chain based on block.timestamp — no keeper needed.
 *
 * Two price behaviours:
 *  - Oscillating (stock / commodity): triangle wave ±10% around startingPrice,
 *    with a 12-hour period (6 full cycles over a 3-day hackathon).
 *  - Trending (ETF): linear upward growth of ~15% over 3 days from deployment.
 */
contract MockBackedOracle is AggregatorV2V3Interface {
    // ── Price behaviour constants ────────────────────────────────────────────

    /// Period of the triangle-wave oscillation (stock / commodity).
    uint256 public constant OSCILLATION_PERIOD = 12 hours;

    /// Amplitude of oscillation expressed in basis points (1000 = ±10%).
    uint256 public constant AMPLITUDE_BPS = 1000;

    /// Reference window used to calibrate ETF growth.
    uint256 public constant HACKATHON_DURATION = 3 days;

    /// Total ETF growth over HACKATHON_DURATION in basis points (1500 = +15%).
    uint256 public constant TOTAL_GROWTH_BPS = 1500;

    // ── State ────────────────────────────────────────────────────────────────

    /// Starting price in 8-decimal fixed point (e.g. $391.20 → 39_120_000_000).
    int256 private _startingPrice;

    /// true → ETF (trending up); false → stock / commodity (oscillating).
    bool private _isTrending;

    /// Timestamp captured at construction, used as the ETF growth origin.
    uint256 private _deploymentTime;

    uint8 private _decimals;
    string private _description;

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        int256 startingPrice_,
        bool isTrending_,
        string memory description_,
        uint8 decimals_
    ) {
        require(startingPrice_ > 0, "MockBackedOracle: startingPrice must be positive");
        _startingPrice = startingPrice_;
        _isTrending = isTrending_;
        _description = description_;
        _decimals = decimals_;
        _deploymentTime = block.timestamp;
    }

    // ── Internal price logic ─────────────────────────────────────────────────

    function _computePrice() internal view returns (int256) {
        if (_isTrending) {
            // Linear growth: +TOTAL_GROWTH_BPS / 10000 over HACKATHON_DURATION.
            uint256 elapsed = block.timestamp - _deploymentTime;
            int256 growth = (_startingPrice * int256(TOTAL_GROWTH_BPS) * int256(elapsed))
                / int256(10000 * HACKATHON_DURATION);
            return _startingPrice + growth;
        } else {
            // Triangle wave oscillation around _startingPrice.
            //
            // Phase within the current period (0 … OSCILLATION_PERIOD-1):
            //   [0,        quarter)  → offset rises  0  →  +A
            //   [quarter,  3*quarter)→ offset falls  +A →  -A
            //   [3*quarter, period)  → offset rises  -A →   0
            //
            uint256 period = OSCILLATION_PERIOD;
            uint256 quarter = period / 4;
            uint256 phase = block.timestamp % period;

            int256 amplitude = (_startingPrice * int256(AMPLITUDE_BPS)) / 10000;
            int256 offset;

            if (phase < quarter) {
                // 0 → +amplitude
                offset = amplitude * int256(phase) / int256(quarter);
            } else if (phase < 3 * quarter) {
                // +amplitude → -amplitude
                offset = amplitude
                    - (amplitude * 2 * int256(phase - quarter))
                    / int256(2 * quarter);
            } else {
                // -amplitude → 0
                offset = -amplitude
                    + amplitude * int256(phase - 3 * quarter)
                    / int256(quarter);
            }

            return _startingPrice + offset;
        }
    }

    // ── Virtual round helpers ────────────────────────────────────────────────

    /// Returns an incrementing virtual round number (one per hour).
    function _currentRound() internal view returns (uint80) {
        return uint80(block.timestamp / 1 hours);
    }

    // ── AggregatorV3Interface ────────────────────────────────────────────────

    function version() external pure override returns (uint256) {
        return 1;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
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
        roundId = _currentRound();
        answer = _computePrice();
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    function getRoundData(uint80 /* _roundId */)
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
        // Historical data is not available in this mock; always return current.
        roundId = _currentRound();
        answer = _computePrice();
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    // ── AggregatorInterface (V2) ─────────────────────────────────────────────

    function latestAnswer() external view override returns (int256) {
        return _computePrice();
    }

    function latestTimestamp() external view override returns (uint256) {
        return block.timestamp;
    }

    function latestRound() external view override returns (uint256) {
        return _currentRound();
    }

    function getAnswer(uint256 /* roundId */) external view override returns (int256) {
        return _computePrice();
    }

    function getTimestamp(uint256 /* roundId */) external view override returns (uint256) {
        return block.timestamp;
    }
}
