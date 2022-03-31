// scripts/test-proxy.ts
import { ethers, upgrades } from "hardhat";

async function main() {
  const BackedTokenImplementation = await ethers.getContractFactory(
    "BackedTokenImplementation"
  );
  const backedToken = await upgrades.deployProxy(
    BackedTokenImplementation,
    ["Token", "TKN"],
    { unsafeAllow: ["constructor"] }
  );
  await backedToken.deployed();
  console.log("backedToken deployed to:", backedToken.address);
  console.log(await backedToken.name());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
