import { ethers } from "hardhat";
import { expect } from "chai";

// eslint-disable-next-line node/no-missing-import

import { BackedTokenImplementationV2 } from "../typechain";
import { getSigner, setMintingAllowance, SignerWithAddress } from "./helpers";

describe("v2", () => {
  let implementation: BackedTokenImplementationV2;

  let owner: SignerWithAddress;
  let minter: SignerWithAddress;

  beforeEach(async () => {
    owner = await getSigner(0);
    minter = await getSigner(1);

    // Deploy the token factory
    implementation = await (
      await ethers.getContractFactory("BackedTokenImplementationV2")
    )
      .connect(owner.signer)
      .deploy();

    await implementation.setMinter(minter.address);
  });

  it("should not allow to mint tokens", async () => {
    await expect(
      implementation.connect(minter.signer).mint(minter.address, 100)
    ).to.revertedWith("BackedToken: Minting allowance low");
  });

  it("should only allow the minter to set the minting allowance", async () => {
    await expect(implementation.setMintAllowance(1000)).to.revertedWith(
      "BackedToken: Only minter"
    );

    const allowanceSetReceipt = await (
      await implementation.connect(minter.signer).setMintAllowance(1000)
    ).wait();

    expect(allowanceSetReceipt.events?.[0]?.event === "NewMintAllowance");
    expect(allowanceSetReceipt.events?.[0]?.args?.[0] === "1000");
  });

  it("should fail if the minting delay has not passed", async () => {
    await implementation.connect(minter.signer).setMintAllowance(1000);

    await expect(
      implementation.connect(minter.signer).mint(minter.address, 1000)
    ).to.revertedWith("BackedToken: Minting time delay");
  });

  it("should be able to mint if the delay has passed", async () => {
    await setMintingAllowance(implementation.connect(minter.signer), 1000);

    const { events } = await (
      await implementation.connect(minter.signer).mint(minter.address, 500)
    ).wait();

    expect((await implementation.mintingAllowance()).eq(500));
    expect((await implementation.balanceOf(minter.address)).eq(500));

    expect(events?.[0].args?.[0]).to.equal(ethers.constants.AddressZero);
    expect(events?.[0].args?.[1]).to.equal(minter.address);
    expect(events?.[0].args?.[2]).to.equal(500);
  });

  it("should not be able to mint if not minter", async () => {
    await setMintingAllowance(implementation.connect(minter.signer), 1000);

    await expect(
      implementation.connect(owner.signer).mint(minter.address, 500)
    ).to.revertedWith("BackedToken: Only minter");
  });
});
