import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { BigNumber, Signer } from "ethers";
// eslint-disable-next-line node/no-missing-import
import { BackedTokenImplementation, BackedFactory, ProxyAdmin } from "../typechain";

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
  let factoryOwner: SignerWithAddress;
  let proxyAdminOwner: SignerWithAddress;

  beforeEach(async () => {
    // Get accounts:
    accounts = await ethers.getSigners();
    factoryOwner = {
      signer: accounts[0],
      address: await accounts[0].getAddress(),
    };
    proxyAdminOwner = {
      signer: accounts[1],
      address: await accounts[1].getAddress(),
    };

    // Deploy factory contract:
    const BackedFactory = await ethers.getContractFactory("BackedFactory");
    factory = await BackedFactory.deploy(proxyAdminOwner.address);

    // Set implementation:
    const implementationAddress = await factory.tokenImplementation();
    const BackedTokenImplementation = await ethers.getContractFactory(
      "BackedTokenImplementation"
    );
    implementation = await BackedTokenImplementation.attach(
      implementationAddress
    );

    // Set proxyAdmin:
    const proxyAdminAddress = await factory.proxyAdmin();
    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin");
    proxyAdmin = await ProxyAdmin.attach(proxyAdminAddress);
  });

  it("Basic owners check", async function () {
    expect(await factory.owner(), factoryOwner.address);
    expect(await proxyAdmin.owner(), proxyAdminOwner.address);
  });

  it("Test implementation", async function () {
    expect(await implementation.name(), "Backed Token Implementation");
    expect(await implementation.symbol(), "BTI");
  });
});
