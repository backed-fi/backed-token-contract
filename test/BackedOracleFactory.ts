import { Signer } from "ethers";
import { ethers } from "hardhat";
import {
  BackedOracleFactory,
  BackedOracle__factory,
  BackedOracleFactory__factory,
} from "../typechain";
import { expect } from "chai";

const validOracleDeployArgs = [8, "Backed Test Oracle"] as const;

describe("BackedOracleFactory", () => {
  let accounts: Signer[];

  let owner: Signer;
  let ownerAddress: string;
  let timelockWorkerAddress: string;

  let contract: BackedOracleFactory;

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    owner = accounts[0];
    ownerAddress = await accounts[0].getAddress();

    timelockWorkerAddress = await accounts[0].getAddress();

    const factory = new BackedOracleFactory__factory(owner);

    contract = await factory.deploy(ownerAddress, [timelockWorkerAddress]);
  });

  it("should have the correct owners", async () => {
    expect(await contract.owner(), ownerAddress);
  });

  it("should allow the owner to deploy oracle", async () => {
    const oracleDeployTransaction = await (
      await contract
        .connect(owner)
        .deployOracle(...validOracleDeployArgs, ownerAddress)
    ).wait();

    const oracleEvent = oracleDeployTransaction.events?.find(
      (e) => e.event === "NewOracle"
    );

    const oracle = new BackedOracle__factory(owner).attach(
      oracleEvent?.args?.newOracle
    );

    expect(oracleEvent).not.eq(undefined);
    expect(await oracle.decimals()).to.eq(validOracleDeployArgs[0]);
    expect(await oracle.description()).to.eq(validOracleDeployArgs[1]);
  });

  it("should allow only the owner to deploy oracles", async () => {
    const factoryWithRandomSigner = new BackedOracleFactory__factory(
      accounts[1]
    ).attach(contract.address);

    expect(
      factoryWithRandomSigner.deployOracle(
        ...validOracleDeployArgs,
        ownerAddress
      )
    ).to.revertedWith("Ownable: caller is not the owner");
  });

  it("should not allow deployment without address for the admin", async () => {
    await expect(
      new BackedOracleFactory__factory(owner).deploy(
        ethers.constants.AddressZero,
        [timelockWorkerAddress]
      )
    ).to.revertedWith("Factory: address should not be 0");
  });

  it("should not allow non owners to change implementation", async () => {
    const newOracleImplementation = await new BackedOracle__factory(
      owner
    ).deploy();

    await expect(
      contract
        .connect(accounts[1])
        .updateImplementation(newOracleImplementation.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should not allow address zero to be set as implementation", async () => {
    await expect(
      contract.updateImplementation(ethers.constants.AddressZero)
    ).to.be.revertedWith("Factory: address should not be 0");
  });

  it("should allow owners to change implementation", async () => {
    const newOracleImplementation = await new BackedOracle__factory(
      owner
    ).deploy();

    expect(await contract.implementation()).to.not.eq(
      newOracleImplementation.address
    );

    await contract.updateImplementation(newOracleImplementation.address);

    expect(await contract.implementation()).to.eq(
      newOracleImplementation.address
    );
  });
});
