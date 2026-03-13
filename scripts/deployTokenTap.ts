import { ethers } from "hardhat";

const deploy = async () => {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const TokenTap = await ethers.getContractFactory("TokenTap", deployer);
  const tap = await TokenTap.deploy();
  await tap.deployed();

  console.log(`✅ TokenTap deployed to ${tap.address}`);
  console.log(`\nSet in .env: TOKEN_TAP_ADDRESS=${tap.address}`);
  console.log(`\nNext: fund the tap by minting tokens directly to ${tap.address}`);
};

deploy()
  .then(() => console.log("\n👏 Script successfully executed"))
  .catch((error) => console.error("🙄 Script errored...", error));
