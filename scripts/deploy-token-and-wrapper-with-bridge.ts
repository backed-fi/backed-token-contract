import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // --- Configuration ---
  const bridgeAddress = deployer.address; // Replace with actual bridge address
  const bridgeMintLimit = ethers.utils.parseEther("1000000"); // 1M shares per window
  const bridgeBurnLimit = ethers.utils.parseEther("1000000"); // 1M shares per window
  const bridgeWindowLength = 24 * 3600; // 24 hours
  const minterAllowance = ethers.utils.parseEther("10000000"); // 10M tokens

  // --- Deploy SanctionsListMock ---
  const SanctionsListMock = await ethers.getContractFactory(
    "SanctionsListMock"
  );
  const sanctionsList = await SanctionsListMock.deploy();
  await sanctionsList.deployed();
  console.log("SanctionsListMock deployed at:", sanctionsList.address);

  // --- Deploy BackedAutoFeeTokenFactory and token ---
  const TokenFactory = await ethers.getContractFactory(
    "BackedAutoFeeTokenFactory"
  );
  const tokenFactory = await TokenFactory.deploy(deployer.address);
  await tokenFactory.deployed();
  console.log("BackedAutoFeeTokenFactory deployed at:", tokenFactory.address);

  const tokenConfig = {
    name: "Backed Test Token",
    symbol: "bTEST",
    tokenOwner: deployer.address,
    minter: deployer.address,
    burner: deployer.address,
    pauser: deployer.address,
    sanctionsList: sanctionsList.address,
    multiplierUpdater: deployer.address,
    periodLength: 24 * 3600,
    lastTimeFeeApplied: Math.floor(Date.now() / 1000),
    feePerPeriod: 0,
  };

  const deployTokenTx = await tokenFactory.deployToken(tokenConfig);
  const deployTokenReceipt = await deployTokenTx.wait();
  const tokenEvent = deployTokenReceipt.events?.find(
    (e: any) => e.event === "NewToken"
  );
  const tokenAddress = tokenEvent?.args?.newToken;
  console.log("BackedAutoFeeToken deployed at:", tokenAddress);

  // --- Deploy WrappedBackedTokenFactory and wrapper ---
  const WrapperFactory = await ethers.getContractFactory(
    "WrappedBackedTokenFactory"
  );
  const wrapperFactory = await WrapperFactory.deploy(deployer.address);
  await wrapperFactory.deployed();
  console.log("WrappedBackedTokenFactory deployed at:", wrapperFactory.address);

  const WrapperImpl = await ethers.getContractFactory(
    "WrappedBackedTokenImplementation"
  );
  const wrapperImpl = await WrapperImpl.deploy();
  await wrapperImpl.deployed();
  await wrapperFactory.updateImplementation(wrapperImpl.address);
  console.log(
    "WrappedBackedTokenImplementation deployed at:",
    wrapperImpl.address
  );

  const wrapperConfig = {
    name: "Wrapped Backed Test Token",
    symbol: "wbTEST",
    underlying: tokenAddress,
    tokenOwner: deployer.address,
    pauser: deployer.address,
    sanctionsList: sanctionsList.address,
  };

  const deployWrapperTx = await wrapperFactory.deployToken(wrapperConfig);
  const deployWrapperReceipt = await deployWrapperTx.wait();
  const wrapperEvent = deployWrapperReceipt.events?.find(
    (e: any) => e.event === "NewToken"
  );
  const wrapperAddress = wrapperEvent?.args?.newToken;
  console.log("WrappedBackedToken deployed at:", wrapperAddress);

  // --- Set minter allowance on underlying token for the wrapper ---
  const token = await ethers.getContractAt(
    "BackedAutoFeeTokenImplementation",
    tokenAddress
  );
  const setMinterTx = await token.setMinterAllowance(
    wrapperAddress,
    minterAllowance
  );
  await setMinterTx.wait();
  console.log(
    "Minter allowance set for wrapper:",
    ethers.utils.formatEther(minterAllowance)
  );

  // --- Configure bridge on the wrapper ---
  const wrapper = await ethers.getContractAt(
    "WrappedBackedTokenImplementation",
    wrapperAddress
  );
  const setBridgeTx = await wrapper.setBridge(
    bridgeAddress,
    bridgeMintLimit,
    bridgeBurnLimit,
    bridgeWindowLength
  );
  await setBridgeTx.wait();
  console.log(
    "Bridge configured:",
    bridgeAddress,
    "limit:",
    ethers.utils.formatEther(bridgeMintLimit),
    "window:",
    bridgeWindowLength,
    "s"
  );

  // --- Summary ---
  console.log("\n=== Deployment Summary ===");
  console.log("SanctionsList:          ", sanctionsList.address);
  console.log("TokenFactory:           ", tokenFactory.address);
  console.log("BackedAutoFeeToken:     ", tokenAddress);
  console.log("WrapperFactory:         ", wrapperFactory.address);
  console.log("WrappedBackedToken:     ", wrapperAddress);
  console.log("Bridge:                 ", bridgeAddress);
  console.log(
    "Bridge mint limit:      ",
    ethers.utils.formatEther(bridgeMintLimit),
    "per",
    bridgeWindowLength / 3600,
    "h"
  );
  console.log(
    "Wrapper minter allowance:",
    ethers.utils.formatEther(minterAllowance)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
