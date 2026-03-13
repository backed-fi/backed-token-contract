// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title TokenTap
 * @notice A faucet that distributes 100 units of any supported ERC-20 token.
 *         Each address may claim each token at most once per hour.
 */
contract TokenTap {
    /// Amount distributed per claim: 100 tokens (18 decimals)
    uint256 public constant CLAIM_AMOUNT = 100 * 10 ** 18;

    /// Cooldown between claims per user per token
    uint256 public constant COOLDOWN = 1 hours;

    /// lastClaimed[user][token] = timestamp of their last successful claim
    mapping(address => mapping(address => uint256)) public lastClaimed;

    event Claimed(address indexed user, address indexed token, uint256 amount);

    /**
     * @notice Claim 100 tokens. Reverts if called again within 1 hour.
     * @param token The ERC-20 token address to claim from.
     */
    function claim(address token) external {
        uint256 last = lastClaimed[msg.sender][token];
        require(block.timestamp >= last + COOLDOWN, "TokenTap: cooldown not elapsed");

        lastClaimed[msg.sender][token] = block.timestamp;

        require(
            IERC20Upgradeable(token).transfer(msg.sender, CLAIM_AMOUNT),
            "TokenTap: transfer failed"
        );

        emit Claimed(msg.sender, token, CLAIM_AMOUNT);
    }

    /**
     * @notice Returns the number of seconds until the caller can claim again.
     *         Returns 0 if the cooldown has already elapsed.
     */
    function cooldownRemaining(address user, address token) external view returns (uint256) {
        uint256 available = lastClaimed[user][token] + COOLDOWN;
        if (block.timestamp >= available) return 0;
        return available - block.timestamp;
    }
}
