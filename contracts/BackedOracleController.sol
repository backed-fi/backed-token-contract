pragma solidity ^0.8.0;

import "./BackedOracle.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract BackedOracleController is AccessControl {
  BackedOracle private _oracle;

  bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

  int8 public constant MAX_PERCENT_DIFFERENCE = 10;
  uint32 public constant MIN_UPDATE_INTERVAL = 1 hours;

  constructor(BackedOracle oracle, address admin) {
    _oracle = oracle;
    _grantRole(DEFAULT_ADMIN_ROLE, admin);
  }

  function updateAnswer(int192 newAnswer, uint32 newTimestamp, uint32 newRound) public onlyRole(UPDATER_ROLE) {
    (,int256 latestAnswer,, uint256 latestTimestamp,) = _oracle.latestRoundData();

    // Timestamp is actual timestamp
    require(newTimestamp < block.timestamp, "Timestamp cannot be in the future");

    // Check that the timestamp is not too old
    require(block.timestamp - newTimestamp <= MIN_UPDATE_INTERVAL / 2, "Timestamp is too old");

    // The timestamp is more than the last timestamp
    require(newTimestamp > latestTimestamp, "Timestamp is older than the last update");

    // The last update happened more than MIN_UPDATE_INTERVAL ago
    require(newTimestamp - latestTimestamp > MIN_UPDATE_INTERVAL, "Timestamp cannot be updated too often");

    // Limit the value to at most MAX_PERCENT_DIFFERENCE% different from the last value
    if (latestAnswer > 0) {
      int192 allowedDeviation = int192(latestAnswer * MAX_PERCENT_DIFFERENCE / 100);

      if (newAnswer > latestAnswer + allowedDeviation) {
        newAnswer = int192(latestAnswer + allowedDeviation);
      } else if (newAnswer < latestAnswer - allowedDeviation) {
        newAnswer = int192(latestAnswer - allowedDeviation);
      }
    }

    _oracle.updateAnswer(newAnswer, newTimestamp, newRound);
  }

  function transferOracleOwnership(address newController) public onlyRole(DEFAULT_ADMIN_ROLE) {
    _oracle.transferOwnership(newController);
  }
}