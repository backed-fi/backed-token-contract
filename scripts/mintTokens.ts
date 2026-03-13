/* eslint-disable camelcase */
import { ethers } from "hardhat";
import { BackedAutoFeeTokenImplementation__factory } from "../typechain";
import tokenConfigs from "./config/sepolia-tokens.json";

const MINT_AMOUNT = ethers.utils.parseUnits("10000000", 18); // 10,000,000 tokens

const mint = async () => {
  const [deployer] = await ethers.getSigners();
  console.log(`Minter: ${deployer.address}`);
  console.log(`Minting ${ethers.utils.formatUnits(MINT_AMOUNT, 18)} of each token\n`);

  for (const config of tokenConfigs) {
    const token = BackedAutoFeeTokenImplementation__factory.connect(
      config.address,
      deployer
    );

    const tx = await token.mint(deployer.address, MINT_AMOUNT);
    await tx.wait();
    console.log(`✅ ${config.symbol} (${config.address}): minted ${ethers.utils.formatUnits(MINT_AMOUNT, 18)}`);
  }

  console.log("\n--- Done ---");
};

mint()
  .then(() => console.log("\n👏 Script successfully executed"))
  .catch((error) => console.error("🙄 Script errored...", error));
