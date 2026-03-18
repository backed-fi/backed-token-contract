import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface TokenConfig {
  name: string;
  symbol: string;
  periodLength: number;
  feePerPeriod: string;
  type: string;
  address: string;
  startingPrice: number;
  oracleAddress?: string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying mock oracles with account:", deployer.address);

  const configPath = path.join(__dirname, "config", "sepolia-tokens.json");
  const tokens: TokenConfig[] = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const MockBackedOracle = await ethers.getContractFactory("MockBackedOracle");

  for (const token of tokens) {
    const isTrending = token.type === "etf";
    // Convert USD price to 8-decimal fixed point integer
    const startingPrice = ethers.BigNumber.from(
      Math.round(token.startingPrice * 1e8)
    );

    console.log(
      `\nDeploying oracle for ${token.symbol} (${token.type})` +
        ` startingPrice=${token.startingPrice} → ${startingPrice.toString()} (8 dec)` +
        ` isTrending=${isTrending}`
    );

    const oracle = await MockBackedOracle.deploy(
      startingPrice,
      isTrending,
      token.name,
      8
    );
    await oracle.deployed();

    token.oracleAddress = oracle.address;
    console.log(`  ✓ ${token.symbol} oracle deployed at ${oracle.address}`);
  }

  // Write updated config back to file
  fs.writeFileSync(configPath, JSON.stringify(tokens, null, 2) + "\n");
  console.log(`\nUpdated ${configPath} with oracleAddress fields.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
