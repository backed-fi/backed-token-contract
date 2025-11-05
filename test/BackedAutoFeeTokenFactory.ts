import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  BackedAutoFeeTokenImplementation,
  BackedAutoFeeTokenFactory,
  ProxyAdmin,
  SanctionsListMock
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedAutoFeeTokenFactory", function () {
  // General config:
  let implementation: BackedAutoFeeTokenImplementation;
  let proxyAdmin: ProxyAdmin;
  let factory: BackedAutoFeeTokenFactory;
  let sanctionsList: SanctionsListMock;

  let accounts: Signer[];

  // Basic config:
  const tokenName = "Backed Apple";
  const tokenSymbol = "bAAPL";

  let random: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let multiplierUpdater: SignerWithAddress;
  let factoryOwner: SignerWithAddress;
  let proxyAdminOwner: SignerWithAddress;
  let tokenContractOwner: SignerWithAddress;

  beforeEach(async () => {
    // Get accounts:
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    factoryOwner = await getSigner(0);
    proxyAdminOwner = await getSigner(1);
    tokenContractOwner = await getSigner(2);
    minter = await getSigner(3);
    burner = await getSigner(4);
    pauser = await getSigner(5);
    random = await getSigner(6);
    blacklister = await getSigner(7);
    multiplierUpdater = await getSigner(8);

    // Deploy factory contract:
    const BackedAutoFeeTokenFactory = await ethers.getContractFactory("BackedAutoFeeTokenFactory");
    factory = await BackedAutoFeeTokenFactory.deploy(proxyAdminOwner.address);

    // Set implementation:
    const implementationAddress = await factory.tokenImplementation();
    implementation = await ethers.getContractAt(
      "BackedAutoFeeTokenImplementation",
      implementationAddress
    );

    // Set proxyAdmin:
    const proxyAdminAddress = await factory.proxyAdmin();
    proxyAdmin = await ethers.getContractAt("ProxyAdmin", proxyAdminAddress);

    // Deploy the Sanctions List contract:
    sanctionsList = await (
      await ethers.getContractFactory("SanctionsListMock", blacklister.signer)
    ).deploy();

    await sanctionsList.deployed();
  });

  it("Basic owners check", async function () {
    expect(await factory.owner(), factoryOwner.address);
    expect(await proxyAdmin.owner(), proxyAdminOwner.address);
  });

  it("Test implementation", async function () {
    expect(await implementation.name(), "Backed Token Implementation");
    expect(await implementation.symbol(), "BTI");
  });

  it("should not allow deployment without proxyAdminOwnerAddress", async () => {
    await expect(
      (
        await ethers.getContractFactory("BackedAutoFeeTokenFactory")
      ).deploy(ethers.constants.AddressZero)
    ).to.revertedWith("Factory: address should not be 0");
  });

  it("should not allow 0 address to be assigned to role", async () => {
    await expect(
      factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: ethers.constants.AddressZero,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: ethers.constants.AddressZero,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: ethers.constants.AddressZero,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: ethers.constants.AddressZero,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).to.revertedWith("Factory: address should not be 0");
  });

  it("should be able to deploy token", async () => {
    const tokenDeployReceipt = await (
      await factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).wait();

    // Expect there to be { NewToken } event
    const newTokenEvent = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    );

    expect(newTokenEvent).not.equal(undefined);
    expect(newTokenEvent?.args?.length).to.equal(3);
    expect(newTokenEvent?.args?.newToken).to.match(/^0x[a-fA-F\d]{40}$/);
    expect(newTokenEvent?.args?.name).to.equal(tokenName);
    expect(newTokenEvent?.args?.symbol).to.equal(tokenSymbol);
  });

  it("should not allow non owners to deploy new token", async () => {
    await expect(
      factory
        .connect(random.signer)
        .deployToken(
          {
            name: tokenName,
            symbol: tokenSymbol,
            tokenOwner: tokenContractOwner.address,
            minter: minter.address,
            burner: burner.address,
            pauser: pauser.address,
            sanctionsList: sanctionsList.address,
            feePerPeriod: 0,
            lastTimeFeeApplied: Math.round(Date.now() / 1000),
            periodLength: 24 * 3600,
            multiplierUpdater: multiplierUpdater.address
          }
        )
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should set the roles", async () => {
    const tokenDeployReceipt = await (
      await factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).wait();

    const tokenContractAddress = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;

    const tokenContract = await ethers.getContractAt(
      "BackedAutoFeeTokenImplementation",
      tokenContractAddress
    );

    // Now check that the roles are set accordingly
    expect(await tokenContract.owner()).to.equal(tokenContractOwner.address);
    expect(await tokenContract.minter()).to.equal(minter.address);
    expect(await tokenContract.pauser()).to.equal(pauser.address);
    expect(await tokenContract.burner()).to.equal(burner.address);
    expect(await tokenContract.multiplierUpdater()).to.equal(multiplierUpdater.address);
  });

  it("should set fee related properties", async () => {
    const configuration = {
      name: tokenName,
      symbol: tokenSymbol,
      tokenOwner: tokenContractOwner.address,
      minter: minter.address,
      burner: burner.address,
      pauser: pauser.address,
      sanctionsList: sanctionsList.address,
      feePerPeriod: 1001,
      lastTimeFeeApplied: Math.floor(Date.now() / 1000) - 3600,
      periodLength: 24 * 3600,
      multiplierUpdater: multiplierUpdater.address
    };
    const tokenDeployReceipt = await (
      await factory.deployToken(
        configuration
      )
    ).wait();

    const tokenContractAddress = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;

    const tokenContract = await ethers.getContractAt(
      "BackedAutoFeeTokenImplementation",
      tokenContractAddress
    );

    // Now check that the roles are set accordingly
    expect(await tokenContract.multiplier()).to.equal(ethers.BigNumber.from(10).pow(18));
    expect(await tokenContract.feePerPeriod()).to.equal(configuration.feePerPeriod);
    expect(await tokenContract.periodLength()).to.equal(configuration.periodLength);
    expect(await tokenContract.lastTimeFeeApplied()).to.equal(configuration.lastTimeFeeApplied);
  });

  it("should not deploy the same token twice", async () => {
    const lastTimeFeeApplied = Math.round(Date.now() / 1000);
    await (
      await factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: lastTimeFeeApplied,
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).wait();

    await expect(
      factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: lastTimeFeeApplied,
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).to.reverted;
  });

  it("should allow to change the implementation", async () => {
    // Deploy new implementation:
    const TokenImplementation2 = await ethers.getContractFactory(
      "BackedAutoFeeTokenImplementation"
    );
    const implementation2 = await TokenImplementation2.deploy();

    // Change implementation:
    const receipt = await (
      await factory.updateImplementation(implementation2.address)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("NewImplementation");
    expect(receipt.events?.[0].args?.[0]).to.equal(implementation2.address);

    // Test the new implementation:
    const tokenDeploymentReceipt = await (
      await factory.deployToken(
        {
          name: tokenName,
          symbol: tokenSymbol,
          tokenOwner: tokenContractOwner.address,
          minter: minter.address,
          burner: burner.address,
          pauser: pauser.address,
          sanctionsList: sanctionsList.address,
          feePerPeriod: 0,
          lastTimeFeeApplied: Math.round(Date.now() / 1000),
          periodLength: 24 * 3600,
          multiplierUpdater: multiplierUpdater.address
        }
      )
    ).wait();

    const newTokenAddress = tokenDeploymentReceipt.events?.find(
      (event) => event.event === "NewToken"
    )?.args?.newToken;

    expect(await proxyAdmin.getProxyImplementation(newTokenAddress)).to.equal(
      implementation2.address
    );
  });

  it("should not allow 0 address to be assigned to implementation", async () => {
    // Check zero implementation fail:
    await expect(
      factory.updateImplementation(ethers.constants.AddressZero)
    ).to.revertedWith("Factory: address should not be 0");
  });

  it("should not allow non owners to change implementation", async () => {
    // Deploy new implementation:
    const TokenImplementation2 = await ethers.getContractFactory(
      "BackedAutoFeeTokenImplementation"
    );
    const implementation2 = await TokenImplementation2.deploy();

    await expect(
      factory
        .connect(random.signer)
        .updateImplementation(implementation2.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });
});
