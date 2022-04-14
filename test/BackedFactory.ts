import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  BackedTokenImplementation,
  BackedFactory,
  ProxyAdmin,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedFactory", function () {
  // General config:
  let implementation: BackedTokenImplementation;
  let proxyAdmin: ProxyAdmin;
  let factory: BackedFactory;

  let accounts: Signer[];

  // Basic config:
  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";

  let random: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
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

    // Deploy factory contract:
    const BackedFactory = await ethers.getContractFactory("BackedFactory");
    factory = await BackedFactory.deploy(proxyAdminOwner.address);

    // Set implementation:
    const implementationAddress = await factory.tokenImplementation();
    implementation = await ethers.getContractAt(
      "BackedTokenImplementation",
      implementationAddress
    );

    // Set proxyAdmin:
    const proxyAdminAddress = await factory.proxyAdmin();
    proxyAdmin = await ethers.getContractAt("ProxyAdmin", proxyAdminAddress);
  });

  it("Basic owners check", async function () {
    expect(await factory.owner(), factoryOwner.address);
    expect(await proxyAdmin.owner(), proxyAdminOwner.address);
  });

  it("Test implementation", async function () {
    expect(await implementation.name(), "Backed Token Implementation");
    expect(await implementation.symbol(), "BTI");
  });

  it("should not allow 0 address to be assigned to role", async () => {
    await expect(
      factory.deployToken(
        tokenName,
        tokenSymbol,
        ethers.constants.AddressZero,
        minter.address,
        burner.address,
        pauser.address
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        tokenName,
        tokenSymbol,
        tokenContractOwner.address,
        ethers.constants.AddressZero,
        burner.address,
        pauser.address
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        tokenName,
        tokenSymbol,
        tokenContractOwner.address,
        minter.address,
        ethers.constants.AddressZero,
        pauser.address
      )
    ).to.revertedWith("Factory: address should not be 0");

    await expect(
      factory.deployToken(
        tokenName,
        tokenSymbol,
        tokenContractOwner.address,
        minter.address,
        burner.address,
        ethers.constants.AddressZero
      )
    ).to.revertedWith("Factory: address should not be 0");
  });

  it("should be able to deploy token", async () => {
    const tokenDeployReceipt = await (
      await factory.deployToken(
        tokenName,
        tokenSymbol,
        tokenContractOwner.address,
        minter.address,
        burner.address,
        pauser.address
      )
    ).wait();

    // Expect there to be { NewToken } event
    const newTokenEvent = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    );

    expect(newTokenEvent).not.equal(undefined);
    expect(newTokenEvent?.args?.length).to.equal(1);
    expect(newTokenEvent?.args?.newToken).to.match(/^0x[a-fA-F\d]{40}$/);
  });

  it("should not allow non owners to deploy new token", async () => {
    await expect(
      factory
        .connect(random.signer)
        .deployToken(
          tokenName,
          tokenSymbol,
          tokenContractOwner.address,
          minter.address,
          burner.address,
          pauser.address
        )
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should set the roles", async () => {
    const tokenDeployReceipt = await (
      await factory.deployToken(
        tokenName,
        tokenSymbol,
        tokenContractOwner.address,
        minter.address,
        burner.address,
        pauser.address
      )
    ).wait();

    const tokenContractAddress = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;

    const tokenContract = await ethers.getContractAt(
      "BackedTokenImplementation",
      tokenContractAddress
    );

    // Now check that the roles are set accordingly
    expect(await tokenContract.owner()).to.equal(tokenContractOwner.address);
    expect(await tokenContract.minter()).to.equal(minter.address);
    expect(await tokenContract.pauser()).to.equal(pauser.address);
    expect(await tokenContract.burner()).to.equal(burner.address);
  });
});
