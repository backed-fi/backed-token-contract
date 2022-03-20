import { expect } from "chai";
import { ethers } from "hardhat";

const tokenName = "Wrapped Apple";
const tokenSymbol = "WAAPL";

describe("BackedToken", function () {
  it("ERC20 basic information", async function () {
    const Token = await ethers.getContractFactory("BackedToken");
    const token = await Token.deploy(tokenName, tokenSymbol);
    await token.deployed();

    expect(await token.name()).to.equal(tokenName);
    expect(await token.symbol()).to.equal(tokenSymbol);
  });
});
