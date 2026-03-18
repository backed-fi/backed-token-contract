/* eslint-disable camelcase */
import { ethers } from "hardhat";
import { BackedAutoFeeTokenImplementation__factory } from "../../typechain";
import tokenConfigs from "./config/sepolia-tokens.json";

const mint = async () => {
  const [deployer] = await ethers.getSigners();
  const config = tokenConfigs[0];

  console.log(`Minter:  ${deployer.address}`);
  console.log(`Token:   ${config.symbol} (${config.address})\n`);

  const token = BackedAutoFeeTokenImplementation__factory.connect(
    config.address,
    deployer
  );

  const amount = ethers.utils.parseUnits("1", 18);
  const tx = await token.mint(deployer.address, amount);
  console.log(`Tx hash: ${tx.hash}`);
  await tx.wait();

  const balance = await token.balanceOf(deployer.address);
  console.log(`✅ Minted 1 ${config.symbol}. New balance: ${ethers.utils.formatUnits(balance, 18)}`);
};

mint()
  .then(() => console.log("\n👏 Done"))
  .catch((error) => console.error("🙄 Script errored...", error));
