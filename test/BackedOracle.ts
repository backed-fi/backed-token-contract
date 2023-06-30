import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  AggregatorV2V3Interface,
  BackedOracle,
  BackedOracleFactory,
  BackedOracleFactory__factory,
  BackedOracle__factory,
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

const oneHour = 3600;
const validOracleDeployArgs = [8, "Backed Test Oracle"] as const;
const validUpdateAnswerArgs = [
  100000,
  Math.round(new Date().getTime() / 1000),
] as const;

describe("BackedOracle", function () {
  // General config:
  let oracle: BackedOracle;
  let oracleFactory: BackedOracleFactory;
  let accounts: Signer[];

  let owner: SignerWithAddress;
  let newOwner: SignerWithAddress;
  let timelockWorker: SignerWithAddress;

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    newOwner = await getSigner(1);
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

    const oracleAddress = oracleTx.events?.find((e) => e.event === "NewOracle")
      ?.args?.newOracle;

    oracle = new BackedOracle__factory(owner.signer).attach(oracleAddress);
  });

  it("should be the correct version", async () => {
    expect(await oracle.version()).to.eq(1);
  });

  it("have the correct decimals and description", async function () {
    expect(await oracle.decimals()).to.eq(validOracleDeployArgs[0]);
    expect(await oracle.description()).to.eq(validOracleDeployArgs[1]);
  });

  it("should not allow update oracle by non updater address", async () => {
    await expect(
      oracle.connect(newOwner.signer).updateAnswer(1, validUpdateAnswerArgs[1])
    ).to.be.revertedWith(
      `AccessControl: account ${newOwner.address.toLowerCase()} is missing role ${await oracle.UPDATER_ROLE()}`
    );
  });

  it("should be able to update the value with valid arguments", async () => {
    // -- Act
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    // -- Assert
    expect((await oracle.latestTimestamp()).toNumber()).to.eq(
      validUpdateAnswerArgs[1]
    );
  });

  it("should revert with timestamp in the future", async () => {
    await expect(
      oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1] + oneHour
      )
    ).to.be.revertedWith("Timestamp cannot be in the future");
  });

  it("should revert with timestamp that is older than 5 minutes", async () => {
    await expect(
      oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1] - 6 * 60
      )
    ).to.be.revertedWith("Timestamp is too old");
  });

  it("should revert with timestamp that is older than last set timestamp", async () => {
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    await expect(
      oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1] - 10
      )
    ).to.be.revertedWith("Timestamp is older than the last update");
  });

  it("should revert if one hour have not passed between updates", async () => {
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    await time.increase(oneHour / 2);

    await expect(
      oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1] + oneHour / 2
      )
    ).to.be.revertedWith("Timestamp cannot be updated too often");
  });

  it("should revert fetching new round before first data is set", async () => {
    await expect(oracle.latestRound()).to.revertedWith("No data present");
    await expect(oracle.latestAnswer()).to.revertedWith("No data present");
    await expect(oracle.latestTimestamp()).to.revertedWith("No data present");
    await expect(oracle.latestRoundData()).to.revertedWith("No data present");
  });

  it("should return the latest round data if that data is set", async () => {
    // -- Setup
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    // -- Act
    const round = await oracle.latestRound();
    const answer = await oracle.latestAnswer();
    const timestamp = await oracle.latestTimestamp();
    const roundData = await oracle.latestRoundData();

    // -- Assert
    expect(round).to.be.above(0);
    expect(answer).to.eq(validUpdateAnswerArgs[0]);
    expect(timestamp).to.eq(validUpdateAnswerArgs[1]);
    expect(roundData).to.not.eq(undefined);
  });

  it("should return the data for specific round", async () => {
    // -- Setup
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    // -- Act
    const round = await oracle.latestRound();
    const answer = await oracle.getAnswer(round);
    const timestamp = await oracle.getTimestamp(round);
    const roundData = await oracle.getRoundData(round);

    // -- Assert
    expect(round).to.be.above(0);
    expect(answer).to.eq(validUpdateAnswerArgs[0]);
    expect(timestamp).to.eq(validUpdateAnswerArgs[1]);
    expect(roundData).to.not.eq(undefined);
  });

  it("should allow update if at least one hour has passed", async () => {
    await oracle.updateAnswer(...validUpdateAnswerArgs);

    await helpers.time.increase(oneHour + 10);

    expect(
      await oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1] + oneHour + 10
      )
    ).to.not.eq(undefined);
  });

  it("should revert when fetching for non existing round", async () => {
    await expect(oracle.getAnswer(1000)).to.revertedWith("No data present");
    await expect(oracle.getTimestamp(1000)).to.revertedWith("No data present");
    await expect(oracle.getRoundData(1000)).to.revertedWith("No data present");
  });

  describe("When price deviates significantly", () => {
    cacheBeforeEach(async () => {
      await oracle.updateAnswer(
        validUpdateAnswerArgs[0],
        validUpdateAnswerArgs[1]
      );
      await time.increase(3700);
    });

    it("should limit update by 10% max increase", async () => {
      // -- Act
      await oracle.updateAnswer(
        validUpdateAnswerArgs[0] * 2,
        validUpdateAnswerArgs[1] + 3700
      );

      // -- Assert
      expect((await oracle.latestAnswer()).toNumber()).to.eq(
        Math.floor(validUpdateAnswerArgs[0] * 1.1)
      );
    });
    it("should limit update by 10% max decrease", async () => {
      // -- Act
      await oracle.updateAnswer(
        validUpdateAnswerArgs[0] * 0.5,
        validUpdateAnswerArgs[1] + 3700
      );

      // -- Assert
      expect((await oracle.latestAnswer()).toNumber()).to.eq(
        Math.floor(validUpdateAnswerArgs[0] * 0.9)
      );
    });
  });
});
