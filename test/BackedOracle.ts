import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  BackedOracle,
  BackedOracle__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedOracle", function () {
  // General config:
  let oracle: BackedOracle;
  let accounts: Signer[];

  // Basic config:
  const description = "Backed Token Oracle";

  let owner: SignerWithAddress;
  let newOwner: SignerWithAddress;

  beforeEach(async () => {
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
  });

  it("Basic owners check", async function () {
    expect(await oracle.owner(), owner.address);
  });

  it("Test implementation", async function () {
    expect(await oracle.description(), description);
    expect(await oracle.decimals()).to.be.equal(8);
  });

  it("should not allow update oracle by non admin user", async () => {
    await oracle.transferOwnership(newOwner.address);

    await expect(oracle.updateAnswer(1, 1, 1)).to.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("should revert fetching new round before first data is set", async () => {
    await expect(oracle.latestRoundData()).to.revertedWith("No data present");
  });

  it("should revert when fetching for non existing round", async () => {
    await expect(oracle.getRoundData(1000)).to.revertedWith("No data present");
  });

  it("should be able to update the value", async () => {
    const newAnswer = 1e8;
    const newTimestamp = 2;
    const newRound = 2;
    const oracleUpdateReceipt = await (
      await oracle.updateAnswer(newAnswer, newTimestamp, newRound)
    ).wait();

    // Expect there to be { AnswerUpdated } event
    const answerUpdatedEvent = oracleUpdateReceipt.events?.find(
      (e) => e.event === "AnswerUpdated"
    );

    expect(answerUpdatedEvent).not.equal(undefined);
    expect(answerUpdatedEvent?.args?.length).to.equal(3);
    expect(answerUpdatedEvent?.args?.roundId).to.equal(newRound);
    expect(answerUpdatedEvent?.args?.updatedAt).to.equal(newTimestamp);
    expect(answerUpdatedEvent?.args?.current).to.equal(newAnswer);

    // Test different ways to retrieve the data
    const latestResponse = await oracle.latestRoundData();

    const [roundId, answer, startedAt, updatedAt, answeredInRound] =
      latestResponse;
    expect(roundId).to.equal(newRound);
    expect(answer).to.equal(newAnswer);
    expect(startedAt).to.equal(newTimestamp);
    expect(updatedAt).to.equal(newTimestamp);
    expect(answeredInRound).to.equal(newTimestamp);

    const latestAnswer = await oracle.latestAnswer();
    expect(latestAnswer).to.equal(newAnswer);
    const latestRound = await oracle.latestRound();
    expect(latestRound).to.equal(newRound);
    const latestTimestamp = await oracle.latestTimestamp();
    expect(latestTimestamp).to.equal(newTimestamp);

    expect(await oracle.getTimestamp(newRound)).to.be.equal(newRound);
    expect(await oracle.getAnswer(newRound)).to.be.equal(newAnswer);

    {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] =
        await oracle.getRoundData(newRound);
      expect(roundId).to.equal(newRound);
      expect(answer).to.equal(newAnswer);
      expect(startedAt).to.equal(newTimestamp);
      expect(updatedAt).to.equal(newTimestamp);
      expect(answeredInRound).to.equal(newTimestamp);
    }
  });
});
