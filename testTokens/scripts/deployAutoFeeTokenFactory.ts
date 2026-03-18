/* eslint-disable camelcase */
import { ethers } from "hardhat";
import { BackedAutoFeeTokenFactory__factory } from "../../typechain";

const deploy = async () => {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const factory = await new BackedAutoFeeTokenFactory__factory(deployer).deploy(
    deployer.address
  );
  await factory.deployed();

  console.log(`\n✅ BackedAutoFeeTokenFactory deployed to ${factory.address}`);
  console.log(`   ProxyAdmin: ${await factory.proxyAdmin()}`);
  console.log(`\nSet in .env: FACTORY_ADDRESS=${factory.address}`);
};

deploy()
  .then(() => console.log("\n👏 Script successfully executed"))
  .catch((error) => console.error("🙄 Script errored...", error));
