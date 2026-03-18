// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../oracle/BackedOracleInterface.sol";

/**
 * @title MockBackedOracle
 * @notice Simple mock oracle for testnet deployments. Returns a fixed price set at construction.
 */
contract MockBackedOracle is AggregatorV2V3Interface {
    int256 private _answer;
    bool public isTrending;
    string private _description;
    uint8 private _decimals;

    uint80 private constant ROUND_ID = 1;
    uint256 private _timestamp;

    constructor(
        int256 startingPrice,
        bool _isTrending,
        string memory description_,
        uint8 decimals_
    ) {
        _answer = startingPrice;
        isTrending = _isTrending;
        _description = description_;
        _decimals = decimals_;
        _timestamp = block.timestamp;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function latestAnswer() external view override returns (int256) {
        return _answer;
    }

    function latestTimestamp() external view override returns (uint256) {
        return _timestamp;
    }

    function latestRound() external view override returns (uint256) {
        return ROUND_ID;
    }

    function getAnswer(uint256) external view override returns (int256) {
        return _answer;
    }

    function getTimestamp(uint256) external view override returns (uint256) {
        return _timestamp;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (_roundId, _answer, _timestamp, _timestamp, _roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (ROUND_ID, _answer, _timestamp, _timestamp, ROUND_ID);
    }
}
