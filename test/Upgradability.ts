import { getSigner, SignerWithAddress } from "./helpers";
import {
  BackedAutoFeeTokenImplementation,
  BackedFactory,
  BackedFactoryV1,
  BackedTokenImplementation,
  BackedTokenImplementationV1,
  SanctionsListMock,
} from "../typechain";
import { ethers } from "hardhat";
import { expect } from "chai";

describe("Upgrade from v1.0.0 to v1.1.0", () => {
  let implementationV2: BackedTokenImplementation;
  let tokenV2: BackedTokenImplementation;
  let tokenV1: BackedTokenImplementationV1;
  let v1Factory: BackedFactoryV1;

  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let tmpAccount: SignerWithAddress;
  let sanctionsList: SanctionsListMock;

  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";

  // ---- Helpers ---- //
  const upgradeContract = async () => {
    const proxyAdmin = await ethers.getContractAt(
      "ProxyAdmin",
      await v1Factory.proxyAdmin()
    );

    implementationV2 = await (
      await ethers.getContractFactory("BackedTokenImplementation")
    ).deploy();

    await proxyAdmin.upgrade(tokenV1.address, implementationV2.address);

    tokenV2 = await ethers.getContractAt(
      "BackedTokenImplementation",
      tokenV1.address
    );
  };

  beforeEach(async () => {
    // Roles:
    owner = await getSigner(0);
    minter = await getSigner(1);
    burner = await getSigner(2);
    pauser = await getSigner(3);
    blacklister = await getSigner(4);
    tmpAccount = await getSigner(5);

    // Deploy the token factory
    v1Factory = await (
      await ethers.getContractFactory("BackedFactoryV1")
    ).deploy(owner.address);

    // Deploy the Sanctions List contract:
    sanctionsList = await (
      await ethers.getContractFactory("SanctionsListMock", blacklister.signer)
    ).deploy();

    const tokenDeploymentReceipt = await (
      await v1Factory.deployToken(
        tokenName,
        tokenSymbol,
        owner.address,
        minter.address,
        burner.address,
        pauser.address,
        sanctionsList.address
      )
    ).wait();

    const deployedTokenAddress = tokenDeploymentReceipt.events?.find(
      (event: any) => event.event === "NewToken"
    )?.args?.newToken;

    tokenV1 = await ethers.getContractAt(
      "BackedTokenImplementation",
      deployedTokenAddress
    );
  });

  it("should not fail update", async () => {
    await upgradeContract();
  });

  it("should have the same info", async () => {
    const nameBefore = await tokenV1.name();
    const symbolBefore = await tokenV1.symbol();
    const ownerBefore = await tokenV1.owner();
    const minterBefore = await tokenV1.minter();

    await upgradeContract();

    expect(nameBefore).to.equal(await tokenV2.name());
    expect(symbolBefore).to.equal(await tokenV2.symbol());
    expect(ownerBefore).to.equal(await tokenV2.owner());
    expect(minterBefore).to.equal(await tokenV2.minter());
  });

  it("should have the correct version", async () => {
    await upgradeContract();

    expect(await tokenV2.VERSION()).to.equal("1.1.0");
  });

  it("should be able to set terms", async () => {
    expect(await tokenV2.terms()).to.equal("");

    await tokenV2.connect(owner.signer).setTerms("My Terms");

    expect(await tokenV2.terms()).to.equal("My Terms");
  });

  it("should have same balances, and transferability", async () => {
    tokenV1.connect(minter.signer).mint(tmpAccount.address, 100);

    await upgradeContract();

    // Check balance:
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(100);

    // Transfer:
    await tokenV2.connect(tmpAccount.signer).transfer(owner.address, 50);
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(50);

    // Mint:
    tokenV1.connect(minter.signer).mint(tmpAccount.address, 100);
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(150);
  });
});

describe("Upgrade from v1.1.0 to auto fee", () => {
  let implementationV2: BackedAutoFeeTokenImplementation;
  let tokenV2: BackedAutoFeeTokenImplementation;
  let tokenV1: BackedTokenImplementation;
  let v1Factory: BackedFactory;

  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let tmpAccount: SignerWithAddress;
  let sanctionsList: SanctionsListMock;

  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";

  // ---- Helpers ---- //
  const upgradeContract = async () => {
    const proxyAdmin = await ethers.getContractAt(
      "ProxyAdmin",
      await v1Factory.proxyAdmin()
    );

    implementationV2 = await (
      await ethers.getContractFactory("BackedAutoFeeTokenImplementation")
    ).deploy();

    await proxyAdmin.upgradeAndCall(tokenV1.address, implementationV2.address, implementationV2.interface.encodeFunctionData(
      'initialize_v2', [
      24 * 3600,
      Math.floor(Date.now() / 1000) - 3600,
      0
    ]));

    tokenV2 = await ethers.getContractAt(
      "BackedAutoFeeTokenImplementation",
      tokenV1.address
    );
  };

  beforeEach(async () => {
    // Roles:
    owner = await getSigner(0);
    minter = await getSigner(1);
    burner = await getSigner(2);
    pauser = await getSigner(3);
    blacklister = await getSigner(4);
    tmpAccount = await getSigner(5);

    // Deploy the token factory
    v1Factory = await (
      await ethers.getContractFactory("BackedFactory")
    ).deploy(owner.address);

    // Deploy the Sanctions List contract:
    sanctionsList = await (
      await ethers.getContractFactory("SanctionsListMock", blacklister.signer)
    ).deploy();

    const tokenDeploymentReceipt = await (
      await v1Factory.deployToken(
        tokenName,
        tokenSymbol,
        owner.address,
        minter.address,
        burner.address,
        pauser.address,
        sanctionsList.address
      )
    ).wait();

    const deployedTokenAddress = tokenDeploymentReceipt.events?.find(
      (event: any) => event.event === "NewToken"
    )?.args?.newToken;

    tokenV1 = await ethers.getContractAt(
      "BackedTokenImplementation",
      deployedTokenAddress
    );
  });

  it("should not fail update", async () => {
    await upgradeContract();
  });

  it("should have the same info", async () => {
    const nameBefore = await tokenV1.name();
    const symbolBefore = await tokenV1.symbol();
    const ownerBefore = await tokenV1.owner();
    const minterBefore = await tokenV1.minter();

    await upgradeContract();

    expect(nameBefore).to.equal(await tokenV2.name());
    expect(symbolBefore).to.equal(await tokenV2.symbol());
    expect(ownerBefore).to.equal(await tokenV2.owner());
    expect(minterBefore).to.equal(await tokenV2.minter());
  });

  it("should have the correct version", async () => {
    await upgradeContract();

    expect(await tokenV2.VERSION()).to.equal("1.1.0");
  });

  it("should be able to set terms", async () => {
    expect(await tokenV2.terms()).to.equal("https://www.backedassets.fi/legal-documentation");

    await tokenV2.connect(owner.signer).setTerms("My Terms");

    expect(await tokenV2.terms()).to.equal("My Terms");
  });

  it("should discard balances and total supply", async () => {
    await tokenV1.connect(minter.signer).mint(tmpAccount.address, 100);

    await upgradeContract();

    // Check balance:
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(0);

    // Check total supply:
    expect(await tokenV2.totalSupply()).to.equal(0);
  });

  it("should allow minting and transferability", async () => {

    await upgradeContract();

    await tokenV1.connect(minter.signer).mint(tmpAccount.address, 100);
    // Check balance:
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(100);

    // Transfer:
    await tokenV2.connect(tmpAccount.signer).transfer(owner.address, 50);
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(50);

    // Mint:
    tokenV1.connect(minter.signer).mint(tmpAccount.address, 100);
    expect(await tokenV2.balanceOf(tmpAccount.address)).to.equal(150);
  });
});
