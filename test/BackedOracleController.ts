import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  BackedOracle,
  BackedOracle__factory,
  BackedOracleController,
  BackedOracleController__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { cacheBeforeEach } from "./helpers";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedOracleController", function () {
  // General config:
  let oracle: BackedOracle;
  let controller: BackedOracleController;
  let accounts: Signer[];

  // Basic config:
  const description = "Backed Token Oracle";

  let owner: SignerWithAddress;
  let newOwner: SignerWithAddress;

  cacheBeforeEach(async () => {
    // Get accounts:
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    newOwner = await getSigner(1);

    // Deploy oracle contract:
    const oracleTx = await new BackedOracle__factory(owner.signer).deploy(
      8,
      description
    );

    oracle = await oracleTx.deployed();

    // Deploy controller contract:
    const controllerTx = await new BackedOracleController__factory(
      owner.signer
    ).deploy(oracle.address, owner.address);

    controller = await controllerTx.deployed();
  });

  it("Basic owners check", async function () {
    expect(
      await controller.hasRole(
        await controller.DEFAULT_ADMIN_ROLE(),
        owner.address
      )
    ).to.be.equal(true);
    expect(
      await controller.hasRole(await controller.UPDATER_ROLE(), owner.address)
    ).to.be.equal(false);
  });

  it("Test implementation", async function () {
    expect(await controller.MAX_PERCENT_DIFFERENCE()).to.be.equal(10);
    expect(await controller.MIN_UPDATE_INTERVAL()).to.be.equal(3600);
  });

  it("should not allow update oracle by user without UPDATED role", async () => {
    await expect(
      controller.connect(newOwner.address).updateAnswer(1, 1, 1)
    ).to.revertedWith(
      `AccessControl: account ${newOwner.address.toLowerCase()} is missing role ${await controller.UPDATER_ROLE()}`
    );
  });

  it("should not transfer oracle ownership by user without ADMIN role", async () => {
    await expect(
      controller
        .connect(newOwner.address)
        .transferOracleOwnership(newOwner.address)
    ).to.revertedWith(
      `AccessControl: account ${newOwner.address.toLowerCase()} is missing role ${await controller.DEFAULT_ADMIN_ROLE()}`
    );
  });

  it("should be able to transfer ownership of oracle contract to new address", async () => {
    await oracle.transferOwnership(controller.address);
    await controller.transferOracleOwnership(newOwner.address);
    expect(await oracle.owner()).to.be.equal(newOwner.address);
  });

  describe("#updateAnswer", () => {
    let newAnswer: number = 1;
    let newTimestamp: number = 1;
    let newRound: number = 1;

    const subject = () => {
      return controller.updateAnswer(newAnswer, newTimestamp, newRound);
    };

    cacheBeforeEach(async () => {
      await controller.grantRole(
        await controller.UPDATER_ROLE(),
        owner.address
      );
    });

    describe("when there is no oracle value yet", () => {
      it("should revert", async () => {
        await oracle.transferOwnership(controller.address);
        await expect(subject()).to.be.revertedWith("No data present");
      });
    });

    describe("when there is already an oracle value", () => {
      const firstAnswer = 1e8;
      const firstTimestamp = 2;
      const firstRound = 2;
      const currentTimestamp = 4e9;
      cacheBeforeEach(async () => {
        await oracle.updateAnswer(firstAnswer, firstTimestamp, firstRound);
        await oracle.transferOwnership(controller.address);
        await time.setNextBlockTimestamp(currentTimestamp);
      });

      describe("and values are within range", () => {
        beforeEach(async () => {
          newAnswer = firstAnswer + 10;
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
        });

        it("should update value on the oracle", async () => {
          await (await subject()).wait();

          const [roundId, answer, , updatedAt] = await oracle.latestRoundData();
          expect(roundId).to.be.equal(newRound);
          expect(answer).to.be.equal(newAnswer);
          expect(updatedAt).to.be.equal(newTimestamp);
        });
      });

      describe("and new answer is exceeding max plus change", () => {
        beforeEach(async () => {
          newAnswer = Math.floor(firstAnswer * 1.15);
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
        });

        it("should update value on the oracle", async () => {
          await (await subject()).wait();

          const [, answer] = await oracle.latestRoundData();
          expect(answer).to.be.equal(Math.floor(firstAnswer * 1.1));
        });
      });

      describe("and new answer is exceeding max minus change", () => {
        beforeEach(async () => {
          newAnswer = Math.floor(firstAnswer * 0.8);
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
        });

        it("should update value on the oracle", async () => {
          await (await subject()).wait();

          const [, answer] = await oracle.latestRoundData();
          expect(answer).to.be.equal(Math.floor(firstAnswer * 0.9));
        });
      });

      describe("and new answer is from future timestamp", () => {
        beforeEach(async () => {
          newAnswer = firstAnswer;
          newTimestamp = currentTimestamp + 3600;
          newRound = firstRound + 10;
        });

        it("should revert with wrong timestamp", async () => {
          await expect(subject()).to.be.revertedWith(
            "Timestamp cannot be in the future"
          );
        });
      });

      describe("and new answer is older than half of hour", () => {
        beforeEach(async () => {
          newAnswer = firstAnswer;
          newTimestamp = currentTimestamp - 1800 - 100;
          newRound = firstRound + 10;
        });

        it("should reject with too old timestamp", async () => {
          await expect(subject()).to.be.revertedWith("Timestamp is too old");
        });
      });

      describe("and new answer takes place too quickly", () => {
        beforeEach(async () => {
          newAnswer = firstAnswer;
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
        });

        it("should revert with update too soon", async () => {
          await subject();
          newTimestamp = currentTimestamp - 5;

          await await expect(subject()).to.be.revertedWith(
            "Timestamp cannot be updated too often"
          );
        });
      });

      describe("and new answer is for older timestamp", () => {
        beforeEach(async () => {
          newAnswer = firstAnswer;
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
        });

        it("should revert with update too soon", async () => {
          await subject();
          newTimestamp = currentTimestamp - 15;

          await await expect(subject()).to.be.revertedWith(
            "Timestamp is older than the last update"
          );
        });
      });

      describe("and there is 0 answer on the oracle", () => {
        beforeEach(async () => {
          newAnswer = 0;
          newTimestamp = currentTimestamp - 10;
          newRound = firstRound + 10;
          await controller.transferOracleOwnership(owner.address);
          await oracle.updateAnswer(newAnswer, newTimestamp, newRound);
          await oracle.transferOwnership(controller.address);
        });

        it("should update the oracle not checking for max change", async () => {
          newAnswer = 1e9;
          newTimestamp = newTimestamp + 3650;
          newRound = firstRound + 11;
          await time.setNextBlockTimestamp(newTimestamp + 5);
          await (await subject()).wait();

          const [, answer] = await oracle.latestRoundData();
          expect(answer).to.be.equal(newAnswer.toString());
        });
      });
    });
  });
});
