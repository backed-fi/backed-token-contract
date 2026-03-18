/* eslint-disable camelcase */
import { ethers } from "hardhat";
import { BackedAutoFeeTokenFactory__factory } from "../../typechain";
import { getEnv } from "../../scripts/helpers/getEnv";
import * as fs from "fs";
import * as path from "path";
import tokenConfigs from "../config/sepolia-tokens.json";

const CONFIG_PATH = path.join(__dirname, "../config/sepolia-tokens.json");

const factoryAddress = getEnv("FACTORY_ADDRESS");

const deploy = async () => {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Factory:  ${factoryAddress}\n`);

  // Resolve sanctions list: use env var if provided, otherwise deploy a mock.
  let sanctionsListAddress = process.env.SANCTIONS_LIST || "";
  if (!sanctionsListAddress) {
    const MockSanctionsList = await ethers.getContractFactory(
      "MockSanctionsList",
      deployer
    );
    const mock = await MockSanctionsList.deploy();
    await mock.deployed();
    sanctionsListAddress = mock.address;
    console.log(`MockSanctionsList deployed to ${sanctionsListAddress}`);
  }

  const factory = BackedAutoFeeTokenFactory__factory.connect(
    factoryAddress,
    deployer
  );

  const deployedTokens: { name: string; symbol: string; address: string }[] =
    [];

  for (const config of tokenConfigs) {
    const lastTimeFeeApplied = Math.floor(Date.now() / 1000);

    const tx = await factory.deployToken({
      name: config.name,
      symbol: config.symbol,
      tokenOwner: deployer.address,
      minter: deployer.address,
      burner: deployer.address,
      pauser: deployer.address,
      sanctionsList: sanctionsListAddress,
      multiplierUpdater: deployer.address,
      periodLength: config.periodLength,
      lastTimeFeeApplied,
      feePerPeriod: config.feePerPeriod,
    });

    const receipt = await tx.wait();
    const newTokenAddress = receipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;

    deployedTokens.push({ name: config.name, symbol: config.symbol, address: newTokenAddress });
    config.address = newTokenAddress;
    console.log(`✅ ${config.symbol} (${config.name}) deployed to ${newTokenAddress}`);
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(tokenConfigs, null, 2) + "\n");
  console.log(`\n📝 Addresses written to ${CONFIG_PATH}`);

  console.log("\n--- Summary ---");
  for (const t of deployedTokens) {
    console.log(`${t.symbol}: ${t.address}`);
  }
};

deploy()
  .then(() => console.log("\n👏 Script successfully executed"))
  .catch((error) => console.error("🙄 Script errored...", error));
