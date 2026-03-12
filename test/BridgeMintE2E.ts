/* eslint-disable camelcase */
/* eslint-disable prettier/prettier */
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  BackedAutoFeeTokenImplementation,
  BackedAutoFeeTokenFactory,
  WrappedBackedTokenImplementation,
  WrappedBackedTokenFactory,
  SanctionsListMock,
} from "../typechain";
import { cacheBeforeEach } from "./helpers";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe.only("Bridge Mint E2E", function () {
  const tokenName = "Backed Test Token";
  const tokenSymbol = "bTEST";
  const wrappedTokenName = "Wrapped Backed Test Token";
  const wrappedTokenSymbol = "wbTEST";
  const baseTime = 2_000_000_000;
  const periodLength = 24 * 3600;
  const bridgeMintLimit = BigNumber.from(10).pow(18).mul(1_000_000); // 1M per window
  const bridgeWindowLength = 24 * 3600; // 24h
  const minterAllowance = BigNumber.from(10).pow(18).mul(10_000_000); // 10M

  let token: BackedAutoFeeTokenImplementation;
  let wrapped: WrappedBackedTokenImplementation;
  let tokenFactory: BackedAutoFeeTokenFactory;
  let wrapperFactory: WrappedBackedTokenFactory;
  let sanctionsList: SanctionsListMock;

  let owner: SignerWithAddress;
  let bridge: SignerWithAddress;
  let bridge2: SignerWithAddress;
  let user: SignerWithAddress;
  let accounts: Signer[];

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    bridge = await getSigner(1);
    bridge2 = await getSigner(2);
    user = await getSigner(3);

    await helpers.time.setNextBlockTimestamp(baseTime);

    // Deploy sanctions list
    sanctionsList = await (
      await ethers.getContractFactory("SanctionsListMock", owner.signer)
    ).deploy();

    // Deploy token via factory
    const TokenFactory = await ethers.getContractFactory("BackedAutoFeeTokenFactory");
    tokenFactory = (await TokenFactory.deploy(owner.address)) as BackedAutoFeeTokenFactory;

    const tokenDeployReceipt = await (
      await tokenFactory.deployToken({
        name: tokenName,
        symbol: tokenSymbol,
        tokenOwner: owner.address,
        minter: owner.address,
        burner: owner.address,
        pauser: owner.address,
        sanctionsList: sanctionsList.address,
        multiplierUpdater: owner.address,
        periodLength: periodLength,
        lastTimeFeeApplied: baseTime,
        feePerPeriod: 0,
      })
    ).wait();

    const tokenAddress = tokenDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;
    token = (await ethers.getContractAt(
      "BackedAutoFeeTokenImplementation",
      tokenAddress
    )) as BackedAutoFeeTokenImplementation;

    // Deploy wrapper via factory
    const WrapperFactory = await ethers.getContractFactory("WrappedBackedTokenFactory");
    wrapperFactory = (await WrapperFactory.deploy(owner.address)) as WrappedBackedTokenFactory;

    const WrapperImpl = await ethers.getContractFactory("WrappedBackedTokenImplementation");
    const wrapperImpl = await WrapperImpl.deploy();
    await wrapperFactory.updateImplementation(wrapperImpl.address);

    const wrapperDeployReceipt = await (
      await wrapperFactory.deployToken({
        name: wrappedTokenName,
        symbol: wrappedTokenSymbol,
        underlying: token.address,
        tokenOwner: owner.address,
        pauser: owner.address,
        sanctionsList: sanctionsList.address,
      })
    ).wait();

    const wrapperAddress = wrapperDeployReceipt.events?.find(
      (e) => e.event === "NewToken"
    )?.args?.newToken;
    wrapped = (await ethers.getContractAt(
      "WrappedBackedTokenImplementation",
      wrapperAddress
    )) as WrappedBackedTokenImplementation;

    // Set minter and burner allowances on underlying token for the wrapper
    await token.setMinterAllowance(wrapped.address, minterAllowance);
    await token.setBurnerAllowance(wrapped.address, minterAllowance);

    // Configure bridge
    await wrapped.setBridge(bridge.address, bridgeMintLimit, bridgeWindowLength);
  });

  this.afterAll(async () => {
    await helpers.reset();
  });

  describe("Deployment verification", () => {
    it("should deploy token with correct name and symbol", async () => {
      expect(await token.name()).to.equal(tokenName);
      expect(await token.symbol()).to.equal(tokenSymbol);
    });

    it("should deploy wrapper with correct name, symbol, and underlying", async () => {
      expect(await wrapped.name()).to.equal(wrappedTokenName);
      expect(await wrapped.symbol()).to.equal(wrappedTokenSymbol);
      expect(await wrapped.asset()).to.equal(token.address);
    });

    it("should set minter allowance on underlying token for wrapper", async () => {
      expect(await token.minterAllowance(wrapped.address)).to.equal(minterAllowance);
    });

    it("should configure bridge with correct limits", async () => {
      const cfg = await wrapped.bridges(bridge.address);
      expect(cfg.mintLimit).to.equal(bridgeMintLimit);
      expect(cfg.windowLength).to.equal(bridgeWindowLength);
    });
  });

  describe("Bridge minting via deposit", () => {
    it("should allow bridge to deposit without holding underlying tokens", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(1000); // 1000 tokens

      // Bridge has no underlying tokens
      expect(await token.balanceOf(bridge.address)).to.equal(0);

      // Bridge deposits — _deposit mints underlying to wrapper
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);

      // Bridge received wrapped tokens
      const wrappedBalance = await wrapped.balanceOf(bridge.address);
      expect(wrappedBalance).to.be.gt(0);

      // Wrapper holds underlying shares
      const wrapperShares = await token.sharesOf(wrapped.address);
      expect(wrapperShares).to.be.gt(0);
    });

    it("should allow bridge to mint (ERC4626 mint) without holding underlying tokens", async () => {
      const mintShares = BigNumber.from(10).pow(18).mul(500);

      await wrapped.connect(bridge.signer).mint(mintShares, user.address);

      const userBalance = await wrapped.balanceOf(user.address);
      // actualShares may differ by 1 due to rounding
      expect(userBalance).to.be.gte(mintShares.sub(1));
    });

    it("should decrease minter allowance on underlying token", async () => {
      const allowanceBefore = await token.minterAllowance(wrapped.address);

      const depositAmount = BigNumber.from(10).pow(18).mul(1000);
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);

      const allowanceAfter = await token.minterAllowance(wrapped.address);
      expect(allowanceAfter).to.be.lt(allowanceBefore);
    });

    it("should track mintedInWindow correctly", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(1000);
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);

      const cfg = await wrapped.bridges(bridge.address);
      expect(cfg.mintedInWindow).to.be.gt(0);
    });

    it("should emit Deposit event", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(100);

      await expect(
        wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address)
      ).to.emit(wrapped, "Deposit");
    });
  });

  describe("Bridge rate limiting", () => {
    it("should revert when bridge exceeds mint limit in a window", async () => {
      const overLimit = bridgeMintLimit.add(BigNumber.from(10).pow(18));

      await expect(
        wrapped.connect(bridge.signer).deposit(overLimit, bridge.address)
      ).to.be.revertedWith("WrappedBackedToken: Bridge mint limit exceeded");
    });

    it("should allow minting up to the limit", async () => {
      // Mint close to the limit (use slightly less to account for rounding)
      const amount = bridgeMintLimit.sub(BigNumber.from(10).pow(18));
      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);

      const balance = await wrapped.balanceOf(bridge.address);
      expect(balance).to.be.gt(0);
    });

    it("should allow multiple mints within the limit", async () => {
      const amount = BigNumber.from(10).pow(18).mul(100_000); // 100k each

      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);
      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);
      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);

      const balance = await wrapped.balanceOf(bridge.address);
      expect(balance).to.be.gt(0);
    });

    it("should reset window after windowLength passes", async () => {
      // Mint close to limit
      const amount = bridgeMintLimit.sub(BigNumber.from(10).pow(18));
      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);

      // Trying to mint more should fail
      await expect(
        wrapped.connect(bridge.signer).deposit(amount, bridge.address)
      ).to.be.revertedWith("WrappedBackedToken: Bridge mint limit exceeded");

      // Advance time past the window
      await helpers.time.increase(bridgeWindowLength + 1);

      // Now minting should work again
      await wrapped.connect(bridge.signer).deposit(amount, bridge.address);

      const balance = await wrapped.balanceOf(bridge.address);
      expect(balance).to.be.gt(0);
    });

    it("should track limits per bridge independently", async () => {
      const bridge2Limit = BigNumber.from(10).pow(18).mul(500_000); // 500k
      await wrapped.setBridge(bridge2.address, bridge2Limit, bridgeWindowLength);

      // Bridge 1 mints 800k
      const amount1 = BigNumber.from(10).pow(18).mul(800_000);
      await wrapped.connect(bridge.signer).deposit(amount1, bridge.address);

      // Bridge 2 can still mint up to its own limit
      const amount2 = BigNumber.from(10).pow(18).mul(400_000);
      await wrapped.connect(bridge2.signer).deposit(amount2, bridge2.address);

      // Bridge 2 exceeding its own limit should fail
      await expect(
        wrapped.connect(bridge2.signer).deposit(amount2, bridge2.address)
      ).to.be.revertedWith("WrappedBackedToken: Bridge mint limit exceeded");
    });
  });

  describe("Normal user deposit (non-bridge)", () => {
    it("should still require underlying tokens for non-bridge users", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(100);

      // Mint some underlying tokens to the user
      await token.mint(user.address, depositAmount);
      await token.connect(user.signer).approve(wrapped.address, depositAmount);

      // User deposits normally
      await wrapped.connect(user.signer).deposit(depositAmount, user.address);

      const balance = await wrapped.balanceOf(user.address);
      expect(balance).to.be.gt(0);
    });

    it("should fail for non-bridge user without underlying tokens", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(100);

      // User has no tokens and no approval
      await expect(
        wrapped.connect(user.signer).deposit(depositAmount, user.address)
      ).to.be.reverted;
    });
  });

  describe("Bridge configuration", () => {
    it("should allow owner to update bridge config", async () => {
      const newLimit = BigNumber.from(10).pow(18).mul(2_000_000);
      const newWindow = 48 * 3600;

      await wrapped.setBridge(bridge.address, newLimit, newWindow);

      const cfg = await wrapped.bridges(bridge.address);
      expect(cfg.mintLimit).to.equal(newLimit);
      expect(cfg.windowLength).to.equal(newWindow);
      expect(cfg.mintedInWindow).to.equal(0); // reset on config change
    });

    it("should allow owner to revoke bridge by setting limit to 0", async () => {
      await wrapped.setBridge(bridge.address, 0, 0);

      // Bridge should now be treated as normal user and fail without tokens
      const depositAmount = BigNumber.from(10).pow(18).mul(100);
      await expect(
        wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address)
      ).to.be.reverted;
    });

    it("should emit BridgeConfigChanged event", async () => {
      await expect(
        wrapped.setBridge(bridge.address, bridgeMintLimit, bridgeWindowLength)
      ).to.emit(wrapped, "BridgeConfigChanged")
        .withArgs(bridge.address, bridgeMintLimit, bridgeWindowLength);
    });

    it("should not allow non-owner to configure bridge", async () => {
      await expect(
        wrapped.connect(bridge.signer).setBridge(bridge.address, bridgeMintLimit, bridgeWindowLength)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Minter allowance on underlying token", () => {
    it("should fail bridge mint when wrapper minter allowance is exhausted", async () => {
      // Set a tiny minter allowance
      await token.setMinterAllowance(wrapped.address, BigNumber.from(10).pow(18).mul(100));
      // Also set a large bridge limit so the bridge limit isn't the blocker
      await wrapped.setBridge(bridge.address, BigNumber.from(10).pow(18).mul(1_000_000), bridgeWindowLength);

      const depositAmount = BigNumber.from(10).pow(18).mul(200); // exceeds 100 minter allowance

      await expect(
        wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address)
      ).to.be.revertedWith("BackedToken: Minter allowance exceeded");
    });
  });

  describe("Wrapped token redeemability (non-bridge)", () => {
    it("should allow normal user to redeem for underlying tokens", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(1000);

      // Mint underlying to user, user deposits normally
      await token.mint(user.address, depositAmount);
      await token.connect(user.signer).approve(wrapped.address, depositAmount);
      await wrapped.connect(user.signer).deposit(depositAmount, user.address);

      const wrappedBalance = await wrapped.balanceOf(user.address);

      // User redeems — should receive underlying tokens
      await wrapped.connect(user.signer).redeem(wrappedBalance, user.address, user.address);

      const userTokenBalance = await token.balanceOf(user.address);
      expect(userTokenBalance).to.be.gt(0);
      expect(userTokenBalance.sub(depositAmount).abs()).to.be.lte(2);
    });
  });

  describe("Bridge burning via withdraw/redeem", () => {
    it("should burn underlying tokens when bridge redeems", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(1000);

      // Bridge mints wrapped tokens
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);
      const wrappedBalance = await wrapped.balanceOf(bridge.address);

      const totalSupplyBefore = await token.totalSupply();

      // Bridge redeems — underlying tokens should be burned, not transferred
      await wrapped.connect(bridge.signer).redeem(wrappedBalance, bridge.address, bridge.address);

      const totalSupplyAfter = await token.totalSupply();

      // Underlying total supply should have decreased
      expect(totalSupplyAfter).to.be.lt(totalSupplyBefore);

      // Bridge should NOT have received underlying tokens
      expect(await token.balanceOf(bridge.address)).to.equal(0);

      // Wrapped token balance should be 0
      expect(await wrapped.balanceOf(bridge.address)).to.equal(0);
    });

    it("should burn underlying tokens when bridge withdraws", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(1000);

      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);

      const totalSupplyBefore = await token.totalSupply();
      const withdrawAmount = depositAmount.div(2);

      await wrapped.connect(bridge.signer).withdraw(withdrawAmount, bridge.address, bridge.address);

      const totalSupplyAfter = await token.totalSupply();
      expect(totalSupplyAfter).to.be.lt(totalSupplyBefore);
      expect(await token.balanceOf(bridge.address)).to.equal(0);
    });

    it("should emit Withdraw event on bridge redeem", async () => {
      const depositAmount = BigNumber.from(10).pow(18).mul(100);
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);
      const wrappedBalance = await wrapped.balanceOf(bridge.address);

      await expect(
        wrapped.connect(bridge.signer).redeem(wrappedBalance, bridge.address, bridge.address)
      ).to.emit(wrapped, "Withdraw");
    });

    it("should fail bridge burn when wrapper burner allowance is exhausted", async () => {
      // Set a tiny burner allowance
      await token.setBurnerAllowance(wrapped.address, BigNumber.from(10).pow(18).mul(50));

      const depositAmount = BigNumber.from(10).pow(18).mul(100);
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);
      const wrappedBalance = await wrapped.balanceOf(bridge.address);

      // Redeeming all should exceed the 50-token burner allowance
      await expect(
        wrapped.connect(bridge.signer).redeem(wrappedBalance, bridge.address, bridge.address)
      ).to.be.revertedWith("BackedToken: Burner allowance exceeded");
    });

    it("should decrease burner allowance on underlying token", async () => {
      const allowanceBefore = await token.burnerAllowance(wrapped.address);

      const depositAmount = BigNumber.from(10).pow(18).mul(1000);
      await wrapped.connect(bridge.signer).deposit(depositAmount, bridge.address);
      const wrappedBalance = await wrapped.balanceOf(bridge.address);

      await wrapped.connect(bridge.signer).redeem(wrappedBalance, bridge.address, bridge.address);

      const allowanceAfter = await token.burnerAllowance(wrapped.address);
      expect(allowanceAfter).to.be.lt(allowanceBefore);
    });
  });

  describe("Burner allowance on underlying token", () => {
    it("should allow owner to set burner allowance", async () => {
      const newAllowance = BigNumber.from(10).pow(18).mul(5000);
      await token.setBurnerAllowance(user.address, newAllowance);
      expect(await token.burnerAllowance(user.address)).to.equal(newAllowance);
    });

    it("should emit BurnerAllowanceChanged event", async () => {
      const newAllowance = BigNumber.from(10).pow(18).mul(5000);
      await expect(token.setBurnerAllowance(user.address, newAllowance))
        .to.emit(token, "BurnerAllowanceChanged")
        .withArgs(user.address, newAllowance);
    });

    it("should allow capped burner to burn own tokens", async () => {
      const amount = BigNumber.from(10).pow(18).mul(100);
      await token.mint(user.address, amount);
      await token.setBurnerAllowance(user.address, amount);

      await token.connect(user.signer).burn(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("should not allow capped burner to burn other accounts' tokens", async () => {
      const amount = BigNumber.from(10).pow(18).mul(100);
      await token.mint(owner.address, amount);
      await token.setBurnerAllowance(user.address, amount);

      await expect(
        token.connect(user.signer).burn(owner.address, amount)
      ).to.be.revertedWith("BackedToken: Cannot burn account");
    });

    it("should revert when capped burner exceeds allowance", async () => {
      const amount = BigNumber.from(10).pow(18).mul(100);
      await token.mint(user.address, amount);
      await token.setBurnerAllowance(user.address, amount.div(2));

      await expect(
        token.connect(user.signer).burn(user.address, amount)
      ).to.be.revertedWith("BackedToken: Burner allowance exceeded");
    });
  });
});
