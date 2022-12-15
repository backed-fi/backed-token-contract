import { getSigner, setMintingAllowance, SignerWithAddress } from "./helpers";
import {
  BackedFactory,
  BackedTokenImplementation,
  BackedTokenImplementationV2,
  SanctionsListMock
} from "../typechain";
import { ethers } from "hardhat";
import { expect } from "chai";

describe("upgradability", () => {
  let implementation: BackedTokenImplementation | BackedTokenImplementationV2;
  let v1Factory: BackedFactory;

  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let sanctionsList: SanctionsListMock;

  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";

  // ---- Helpers ---- //
  const upgradeContract = async () => {
    const proxyAdmin = await ethers.getContractAt(
      "ProxyAdmin",
      await v1Factory.proxyAdmin()
    );

    const v2 = await (
      await ethers.getContractFactory("BackedTokenImplementationV2")
    ).deploy();

    await proxyAdmin.upgrade(implementation.address, v2.address);

    implementation = await ethers.getContractAt(
      "BackedTokenImplementationV2",
      implementation.address
    );
  };

  beforeEach(async () => {
    owner = await getSigner(0);
    minter = await getSigner(1);
    burner = await getSigner(2);
    pauser = await getSigner(3);
    blacklister = await getSigner(4);

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
      (event) => event.event === "NewToken"
    )?.args?.newToken;

    implementation = await ethers.getContractAt(
      "BackedTokenImplementation",
      deployedTokenAddress
    );
  });

  it("should not fail update", async () => {
    await upgradeContract();
  });

  it("should have the same values", async () => {
    const nameBefore = await implementation.name();
    const ownerBefore = await implementation.owner();
    const minterBefore = await implementation.minter();

    await upgradeContract();

    expect(nameBefore).to.equal(await implementation.name());
    expect(ownerBefore).to.equal(await implementation.owner());
    expect(minterBefore).to.equal(await implementation.minter());
  });

  it("should have minting allowance", async () => {
    await upgradeContract();

    expect(
      implementation.connect(minter.signer).mint(minter.address, 1000)
    ).to.revertedWith("BackedToken: Minting allowance low");
  });

  it("should be able to mint correctly if upgraded", async () => {
    await upgradeContract();

    expect(
      await (implementation as BackedTokenImplementationV2).mintingAllowance()
    ).to.equal(0);

    await setMintingAllowance(
      implementation.connect(minter.signer) as BackedTokenImplementationV2,
      1000
    );

    const receipt = await (
      await implementation.connect(minter.signer).mint(minter.address, 900)
    ).wait();

    expect(receipt.events?.[0].event).to.equal("Transfer");
    expect(receipt.events?.[0].args?.[0]).to.equal(
      ethers.constants.AddressZero
    );
    expect(receipt.events?.[0].args?.[1]).to.equal(minter.address);
    expect(receipt.events?.[0].args?.[2]).to.equal(900);

    expect(await implementation.balanceOf(minter.address)).to.equal(900);
    expect(
      await (implementation as BackedTokenImplementationV2).mintingAllowance()
    ).to.equal(100);
  });
});
