/**
 * Multiplier Keeper
 *
 * Runs on a schedule (every 2 hours via Cloud Scheduler + Cloud Run Job) and
 * increases the rebase multiplier of each hackathon token by a small random
 * amount (up to MAX_DELTA = 0.02 * 1e18).
 *
 * Environment variables:
 *   MULTIPLIER_UPDATER_PK  — private key of the multiplierUpdater wallet
 *   SEPOLIA_RPC_URL        — Sepolia JSON-RPC endpoint
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

dotenv.config();

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum multiplier increment per run (0.02 * 1e18). */
const MAX_DELTA = BigInt("20000000000000000"); // 2e16

const TOKEN_ABI = [
  "function getCurrentMultiplier() view returns (uint256 currentMultiplier, uint256 periodsPassed, uint256 currentMultiplierNonce)",
  "function updateMultiplierValue(uint256 pendingNewMultiplier, uint256 oldMultiplier, uint256 pendingNewMultiplierActivationTime)",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

/** Returns a random BigInt in [0, max). */
function randomBigInt(max: bigint): bigint {
  // Math.random() gives enough entropy for a hackathon mock
  return BigInt(Math.floor(Math.random() * Number(max)));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pk = requireEnv("MULTIPLIER_UPDATER_PK");
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  console.log(`Multiplier keeper starting. Wallet: ${wallet.address}`);

  // In Docker the config is copied to ./config/; locally (ts-node from repo root) it's ../config/
  const configPath = fs.existsSync(path.join(__dirname, "config/sepolia-tokens.json"))
    ? path.join(__dirname, "config/sepolia-tokens.json")
    : path.join(__dirname, "../config/sepolia-tokens.json");
  const tokens: Array<{ name: string; symbol: string; address: string; isMultiplierChanging?: boolean }> =
    JSON.parse(fs.readFileSync(configPath, "utf8"));

  let successCount = 0;
  let errorCount = 0;

  for (const token of tokens) {
    if (!token.isMultiplierChanging) {
      console.log(`[${token.symbol}] skipped (isMultiplierChanging=false)`);
      continue;
    }

    try {
      const contract = new ethers.Contract(token.address, TOKEN_ABI, wallet);

      const { currentMultiplier } = await contract.getCurrentMultiplier();
      const current: bigint = currentMultiplier.toBigInt();

      const delta = randomBigInt(MAX_DELTA) + BigInt(1); // at least 1
      const next = current + delta;

      const activationTime = Math.floor(Date.now() / 1000) + 6 * 60 * 60; // now + 3 hours

      console.log(
        `[${token.symbol}] multiplier ${current} → ${next} (+${delta}), activates at ${new Date(activationTime * 1000).toISOString()}`
      );

      const tx = await contract.updateMultiplierValue(
        next.toString(),
        current.toString(),
        activationTime
      );
      await tx.wait();

      console.log(`  ✓ tx: ${tx.hash}`);
      successCount++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ [${token.symbol}] failed: ${message}`);
      errorCount++;
    }
  }

  console.log(
    `\nDone. ${successCount} succeeded, ${errorCount} failed out of ${tokens.length} tokens.`
  );

  // Non-zero exit code if all tokens failed (alerts Cloud Run Job as a failure)
  if (errorCount === tokens.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
