import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  AggregatorV2V3Interface,
  BackedOracleFactory,
  BackedOracleFactory__factory,
  BackedOracleForwarder,
  BackedOracleForwarder__factory,
  TimelockController__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { cacheBeforeEach } from "./helpers";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

const validOracleDeployArgs = [8, "Backed Test Oracle"] as const;

describe("BackedOracleForwarder", function () {
  // General config:
  let forwarder: BackedOracleForwarder;
  let oracleFactory: BackedOracleFactory;
  let accounts: Signer[];

  let owner: SignerWithAddress;
  let timelockWorker: SignerWithAddress;

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    timelockWorker = await getSigner(2);

    oracleFactory = await (
      await new BackedOracleFactory__factory(owner.signer).deploy(
        owner.address,
        [timelockWorker.address]
      )
    ).deployed();

    // Deploy oracle contract:
    const oracleTx = await (
      await oracleFactory.deployOracle(...validOracleDeployArgs, owner.address)
    ).wait();

    const forwarderAddress = oracleTx.events?.find(
      (e) => e.event === "NewOracleForwarder"
    )?.args?.newOracleForwarder;

    forwarder = new BackedOracleForwarder__factory(owner.signer).attach(
      forwarderAddress
    );
  });

  it("should not allow to update upstream oracle address by non owner", async () => {
    await expect(
      forwarder.setUpstreamOracle(ethers.constants.AddressZero)
    ).to.revertedWith("Ownable: caller is not the owner");
  });

  describe("When upstream oracle is set", () => {
    let oracleMock: FakeContract<AggregatorV2V3Interface>;
    beforeEach(async () => {
      oracleMock = await smock.fake<AggregatorV2V3Interface>(
        "AggregatorV2V3Interface"
      );
      const timelock = TimelockController__factory.connect(
        await oracleFactory.timelockController(),
        timelockWorker.signer
      );
      const functionData = forwarder.interface.encodeFunctionData(
        "setUpstreamOracle",
        [oracleMock.address]
      );
      await timelock.schedule(
        forwarder.address,
        0,
        functionData,
        ethers.constants.HashZero,
        ethers.constants.HashZero,
        7 * 24 * 3600
      );
      await time.increase(8 * 24 * 3600);
      await timelock.execute(
        forwarder.address,
        0,
        functionData,
        ethers.constants.HashZero,
        ethers.constants.HashZero
      );
    });

    it("should take decimals from upstream oracle", async () => {
      oracleMock.decimals.returns(6);
      await expect(await forwarder.decimals()).to.eq(6);
    });

    it("should take version from upstream oracle", async () => {
      oracleMock.version.returns(6);
      await expect(await forwarder.version()).to.eq(6);
    });

    it("should take description from upstream oracle", async () => {
      oracleMock.description.returns("test");
      await expect(await forwarder.description()).to.eq("test");
    });

    it("should take latestRound from upstream oracle", async () => {
      oracleMock.latestRound.returns(12345);
      await expect(await forwarder.latestRound()).to.eq(12345);
    });

    it("should take latestTimestamp from upstream oracle", async () => {
      oracleMock.latestTimestamp.returns(12345);
      await expect(await forwarder.latestTimestamp()).to.eq(12345);
    });

    it("should take latestAnswer from upstream oracle", async () => {
      oracleMock.latestAnswer.returns(12345);
      await expect(await forwarder.latestAnswer()).to.eq(12345);
    });

    it("should take latestRoundData from upstream oracle", async () => {
      oracleMock.latestRoundData.returns([0, 1, 2, 3, 4]);
      expect(await forwarder.latestRoundData()).to.have.deep.members(
        [0, 1, 2, 3, 4].map(ethers.BigNumber.from)
      );
    });

    it("should take getAnswer from upstream oracle", async () => {
      oracleMock.getAnswer.returns(1234);
      expect(await forwarder.getAnswer(1000)).to.eq(1234);
    });

    it("should take getTimestamp from upstream oracle", async () => {
      oracleMock.getTimestamp.returns(1234);
      expect(await forwarder.getTimestamp(1000)).to.eq(1234);
    });

    it("should take getRoundData from upstream oracle", async () => {
      oracleMock.getRoundData.returns([0, 1, 2, 3, 4]);
      expect(await forwarder.getRoundData(1234)).to.have.deep.members(
        [0, 1, 2, 3, 4].map(ethers.BigNumber.from)
      );
    });
  });
});