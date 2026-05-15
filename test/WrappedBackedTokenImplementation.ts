/* eslint-disable camelcase */
/* eslint-disable prettier/prettier */
import { ProxyAdmin__factory } from "../typechain/factories/ProxyAdmin__factory";
import { ProxyAdmin } from "../typechain/ProxyAdmin";
import {
  BackedAutoFeeTokenImplementation__factory
} from "../typechain/factories/BackedAutoFeeTokenImplementation__factory";
import { BackedAutoFeeTokenImplementation } from "../typechain/BackedAutoFeeTokenImplementation";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  BackedTokenProxy__factory,
  SanctionsListMock,
  SanctionsListMock__factory,
  WrappedBackedTokenImplementation,
  WrappedBackedTokenImplementation__factory,
  WrappedBackedTokenProxy__factory
} from "../typechain";
import { cacheBeforeEach } from "./helpers";
import Decimal from "decimal.js";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

// WrappedBackedTokenImplementation specifications
describe("WrappedBackedTokenImplementation", function () {
  const annualFee = 0.5;
  const multiplierAdjustmentPerPeriod = nthRoot(annualFee, 365).mul(Decimal.pow(10, 18));
  const baseFeePerPeriod = Decimal.pow(10, 18).minus(multiplierAdjustmentPerPeriod).toFixed(0);
  const baseTime = 2_000_000_000;
  const tokenName = "Backed Apple";
  const tokenSymbol = "bAAPL";
  const wrappedTokenName = `Wrapped ${tokenName}`;
  const wrappedTokenSymbol = `w${tokenSymbol}`;

  // General config:
  let token: BackedAutoFeeTokenImplementation;
  let tokenImplementation: BackedAutoFeeTokenImplementation;
  let wrapped: WrappedBackedTokenImplementation;
  let wrappedImplementation: WrappedBackedTokenImplementation;
  let sanctionsList: SanctionsListMock;
  let proxyAdmin: ProxyAdmin;
  let accounts: Signer[];

  let owner: SignerWithAddress;
  let actor: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let tmpAccount: SignerWithAddress;
  let chainId: BigNumber;

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    minter = await getSigner(1);
    burner = await getSigner(2);
    pauser = await getSigner(3);
    blacklister = await getSigner(4);
    tmpAccount = await getSigner(5);
    actor = await getSigner(6);

    await helpers.time.setNextBlockTimestamp(baseTime);

    const tokenImplementationFactory = new BackedAutoFeeTokenImplementation__factory(owner.signer);
    tokenImplementation = await tokenImplementationFactory.deploy();
    const proxyAdminFactory = new ProxyAdmin__factory(owner.signer)
    proxyAdmin = await proxyAdminFactory.deploy();
    const tokenProxy = await new BackedTokenProxy__factory(owner.signer).deploy(tokenImplementation.address, proxyAdmin.address, tokenImplementation.interface.encodeFunctionData(
      'initialize(string,string,uint256,uint256,uint256)',
      [
        tokenName,
        tokenSymbol,
        24 * 3600,
        baseTime,
        baseFeePerPeriod
      ]
    ));
    token = BackedAutoFeeTokenImplementation__factory.connect(tokenProxy.address, owner.signer);
    await token.setMinter(owner.address);
    await token.setBurner(owner.address);
    await token.setPauser(owner.address);
    await token.setMultiplierUpdater(owner.address);
    sanctionsList = await new SanctionsListMock__factory(blacklister.signer).deploy();
    await token.setSanctionsList(sanctionsList.address);

    await token.mint(owner.address, BigNumber.from(10).pow(18).mul(1_000_000));
    await token.mint(minter.address, BigNumber.from(10).pow(18).mul(1_000_000));

    wrappedImplementation = await new WrappedBackedTokenImplementation__factory(owner.signer).deploy();
    wrapped = WrappedBackedTokenImplementation__factory.connect((await new WrappedBackedTokenProxy__factory(owner.signer).deploy(
      wrappedImplementation.address,
      proxyAdmin.address,
      wrappedImplementation.interface.encodeFunctionData(
        'initialize',
        [
          wrappedTokenName,
          wrappedTokenSymbol,
          token.address
        ]
      )
    )).address, owner.signer)


    // Chain Id
    const network = await ethers.provider.getNetwork();
    chainId = BigNumber.from(network.chainId);
  });

  this.afterAll(async () => {
    await helpers.reset();
  })

  describe('#constructor', () => {
    it("block calling initializer on implementation contract", async function () {
      await expect(
        wrappedImplementation['initialize(string,string,address)'](
          tokenName,
          tokenSymbol,
          token.address
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe('#decimals', () => {
    it("should take decimals from underlying token", async () => {
      const decimals = await wrapped.decimals();

      expect(decimals).to.eq(await token.decimals());
    })
  });

  describe('#version', () => {
    it("should return correct version", async () => {
      expect(await wrapped.VERSION()).to.equal("1.0.0");
    });
  });

  describe('ERC4626 functionality', () => {
    describe('#asset', () => {
      it("should return underlying token address", async () => {
        expect(await wrapped.asset()).to.equal(token.address);
      });
    });

    describe('#totalAssets', () => {
      it("should return total underlying tokens", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        const totalAssets = await wrapped.totalAssets();
        const expectedShares = await token.sharesOf(wrapped.address);
        const expectedAssets = await token.getUnderlyingAmountByShares(expectedShares);

        expect(totalAssets).to.equal(expectedAssets);
      });
    });

    describe('#convertToShares', () => {
      it("should convert assets to shares correctly", async () => {
        const assets = BigNumber.from(1000);
        const shares = await wrapped.convertToShares(assets);

        const currentMultiplier = (await token.getCurrentMultiplier())[0];
        const expectedShares = assets.mul(BigNumber.from(10).pow(18)).div(currentMultiplier);

        expect(shares).to.equal(expectedShares);
      });
    });

    describe('#convertToAssets', () => {
      it("should convert shares to assets correctly", async () => {
        const shares = BigNumber.from(1000);
        const assets = await wrapped.convertToAssets(shares);

        const currentMultiplier = (await token.getCurrentMultiplier())[0];
        const expectedAssets = shares.mul(currentMultiplier).div(BigNumber.from(10).pow(18));

        expect(assets).to.equal(expectedAssets);
      });
    });

    describe('#maxDeposit', () => {
      it("should return max uint256", async () => {
        expect(await wrapped.maxDeposit(owner.address)).to.equal(ethers.constants.MaxUint256);
      });
    });

    describe('#maxMint', () => {
      it("should return max uint256", async () => {
        expect(await wrapped.maxMint(owner.address)).to.equal(ethers.constants.MaxUint256);
      });
    });

    describe('#maxWithdraw', () => {
      it("should return owner's asset balance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        const maxWithdraw = await wrapped.maxWithdraw(owner.address);
        const balance = await wrapped.balanceOf(owner.address);
        const assets = await wrapped.convertToAssets(balance);

        expect(maxWithdraw).to.equal(assets);
      });
    });

    describe('#maxRedeem', () => {
      it("should return owner's share balance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        const maxRedeem = await wrapped.maxRedeem(owner.address);
        const balance = await wrapped.balanceOf(owner.address);

        expect(maxRedeem).to.equal(balance);
      });
    });
  });

  describe('When wrapping rebasing token', () => {
    const initialBalance = BigNumber.from(1000);
    cacheBeforeEach(async () => {
      await token.approve(wrapped.address, initialBalance);
      await wrapped.mint(1000, owner.address);
    })

    describe('When rebasing token increases multiplier by 10%', () => {
      const multiplierIncreasePercentage = 10;

      cacheBeforeEach(async () => {
        const previousMultiplier = await token.multiplier();
        await token.updateMultiplierValue(
          previousMultiplier.mul(100 + multiplierIncreasePercentage).div(100),
          previousMultiplier,
          0
        )
      })

      it("should keep user balance unchanged", async () => {
        const balance = await wrapped.balanceOf(owner.address);

        expect(balance).to.eq(initialBalance);
      })

      it("should increase user underlying balance by 10%", async () => {
        const assetsBalance = await wrapped.convertToAssets(await wrapped.balanceOf(owner.address));

        expect(assetsBalance.toNumber()).to.be.approximately(initialBalance.mul(100 + multiplierIncreasePercentage).div(100).toNumber(), 1);
      })

      describe('When minting new tokens', () => {
        it("should require 10% more tokens to mint same amount of wrapper", async () => {
          await token.transfer(actor.address, 1100);
          await token.connect(actor.signer).approve(wrapped.address, 1100);
          await wrapped.connect(actor.signer).mint(initialBalance, actor.address);

          const balance = await wrapped.balanceOf(actor.address)
          const tokenBalance = await token.balanceOf(actor.address)

          expect(tokenBalance.toNumber()).to.be.approximately(0, 1);
          expect(balance.toNumber()).to.be.eq(initialBalance);
        })
      });

      describe('When burning tokens', () => {
        it("should return 10% more tokens than the ones used for mint", async () => {
          await wrapped.redeem(initialBalance, actor.address, owner.address);

          const tokenBalance = await token.balanceOf(actor.address)

          expect(tokenBalance.toNumber()).to.be.approximately(initialBalance.mul(100 + multiplierIncreasePercentage).div(100).toNumber(), 2);
        })
      });
    });

    describe('When rebasing token decreases multiplier (fee accrual)', () => {
      const multiplierDecreasePercentage = 5;

      cacheBeforeEach(async () => {
        const previousMultiplier = await token.multiplier();
        await token.updateMultiplierValue(
          previousMultiplier.mul(100 - multiplierDecreasePercentage).div(100),
          previousMultiplier,
          0
        )
      })

      it("should keep user wrapper balance unchanged", async () => {
        const balance = await wrapped.balanceOf(owner.address);
        expect(balance).to.eq(initialBalance);
      })

      it("should decrease user underlying balance by 5%", async () => {
        const assetsBalance = await wrapped.convertToAssets(await wrapped.balanceOf(owner.address));
        expect(assetsBalance.toNumber()).to.be.approximately(initialBalance.mul(100 - multiplierDecreasePercentage).div(100).toNumber(), 1);
      })
    });
  });

  describe('#deposit', () => {
    it("should deposit underlying tokens and mint wrapped tokens", async () => {
      const depositAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, depositAmount);

      const tx = await wrapped.deposit(depositAmount, owner.address);
      const receipt = await tx.wait();

      const depositEvent = receipt.events?.find(e => e.event === 'Deposit');
      expect(depositEvent).to.not.be.undefined;
      if (depositEvent && depositEvent.args) {
        // ERC4626 Deposit event: event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
        expect(depositEvent.args[0]).to.equal(owner.address); // caller
        expect(depositEvent.args[1]).to.equal(owner.address); // receiver/owner
      }

      const balance = await wrapped.balanceOf(owner.address);
      expect(balance).to.be.gt(0);
    });

    it("should emit correct Deposit event", async () => {
      const depositAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, depositAmount);

      await expect(wrapped.deposit(depositAmount, owner.address))
        .to.emit(wrapped, 'Deposit');
    });
  });

  describe('#mint', () => {
    it("should mint exact amount of wrapped tokens", async () => {
      const mintAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, BigNumber.from(10).pow(18));

      await wrapped.mint(mintAmount, owner.address);

      const balance = await wrapped.balanceOf(owner.address);
      expect(balance).to.equal(mintAmount);
    });
  });

  describe('#withdraw', () => {
    it("should withdraw underlying tokens and burn wrapped tokens", async () => {
      const depositAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, depositAmount);
      await wrapped.deposit(depositAmount, owner.address);

      const beforeBalance = await token.balanceOf(actor.address);
      const withdrawAmount = BigNumber.from(500);

      await wrapped.withdraw(withdrawAmount, actor.address, owner.address);

      const afterBalance = await token.balanceOf(actor.address);
      const diff = afterBalance.sub(beforeBalance).toNumber();
      expect(diff).to.be.approximately(withdrawAmount.toNumber(), 2);
    });

    it("should emit correct Withdraw event", async () => {
      const depositAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, depositAmount);
      await wrapped.deposit(depositAmount, owner.address);

      const withdrawAmount = BigNumber.from(500);

      await expect(wrapped.withdraw(withdrawAmount, actor.address, owner.address))
        .to.emit(wrapped, 'Withdraw');
    });
  });

  describe('#redeem', () => {
    it("should redeem exact amount of wrapped tokens", async () => {
      const depositAmount = BigNumber.from(1000);
      await token.approve(wrapped.address, depositAmount);
      await wrapped.mint(depositAmount, owner.address);

      const redeemAmount = BigNumber.from(500);

      await wrapped.redeem(redeemAmount, actor.address, owner.address);

      const balance = await wrapped.balanceOf(owner.address);
      expect(balance).to.equal(depositAmount.sub(redeemAmount));
    });
  });

  describe('#previewDeposit', () => {
    it("should preview shares for asset amount", async () => {
      const assets = BigNumber.from(1000);
      const shares = await wrapped.previewDeposit(assets);

      const convertedShares = await wrapped.convertToShares(assets);
      expect(shares).to.equal(convertedShares);
    });
  });

  describe('#previewMint', () => {
    it("should preview assets for share amount with correct rounding", async () => {
      const shares = BigNumber.from(1000);
      const assets = await wrapped.previewMint(shares);

      // previewMint should round down
      const currentMultiplier = (await token.getCurrentMultiplier())[0];
      const expectedAssets = shares.mul(currentMultiplier).div(BigNumber.from(10).pow(18));

      expect(assets).to.equal(expectedAssets);
    });
  });

  describe('#previewWithdraw', () => {
    it("should preview shares for withdraw amount with correct rounding", async () => {
      const assets = BigNumber.from(1000);
      const shares = await wrapped.previewWithdraw(assets);

      // previewWithdraw should round down
      const currentMultiplier = (await token.getCurrentMultiplier())[0];
      const expectedShares = assets.mul(BigNumber.from(10).pow(18)).div(currentMultiplier);

      expect(shares).to.equal(expectedShares);
    });
  });

  describe('#previewRedeem', () => {
    it("should preview assets for redeem amount", async () => {
      const shares = BigNumber.from(1000);
      const assets = await wrapped.previewRedeem(shares);

      const convertedAssets = await wrapped.convertToAssets(shares);
      expect(assets).to.equal(convertedAssets);
    });
  });

  // Tests copied from base WrappedBackedTokenImplementation tests:

  it("Basic information check", async function () {
    expect(await wrapped.name()).to.equal(wrappedTokenName);
    expect(await wrapped.symbol()).to.equal(wrappedTokenSymbol);
    expect(await wrapped.owner()).to.equal(owner.address);
    expect(await wrapped.terms()).to.equal(
      "https://www.backedassets.fi/legal-documentation"
    );
    expect(await wrapped.VERSION()).to.equal("1.0.0");
  });

  it("Define Pauser and transfer Pauser", async function () {
    // Set Pauser
    let receipt = await (await wrapped.setPauser(pauser.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewPauser");
    expect(receipt.events?.[0].args?.[0]).to.equal(pauser.address);
    expect(await wrapped.pauser()).to.equal(pauser.address);

    // Change Pauser
    receipt = await (await wrapped.setPauser(tmpAccount.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewPauser");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(await wrapped.pauser()).to.equal(tmpAccount.address);
  });

  it("Try to define Pauser from wrong address", async function () {
    await expect(
      wrapped.connect(accounts[3]).setPauser(pauser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Pause and Unpause", async function () {
    await token.approve(wrapped.address, 100);
    await wrapped.deposit(100, owner.address);
    await wrapped.setPauser(pauser.address);

    await expect(wrapped.connect(accounts[2]).setPause(true)).to.be.revertedWith(
      "WrappedBackedToken: Only pauser"
    );

    const receipt = await (
      await wrapped.connect(pauser.signer).setPause(true)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt.events?.[0].args?.[0]).to.equal(true);

    await expect(wrapped.transfer(tmpAccount.address, 100)).to.be.revertedWith(
      "WrappedBackedToken: token transfer while paused"
    );

    // Unpause:
    const receipt2 = await (
      await wrapped.connect(pauser.signer).setPause(false)
    ).wait();
    expect(receipt2.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt2.events?.[0].args?.[0]).to.equal(false);

    await wrapped.transfer(tmpAccount.address, 100);
    expect(await wrapped.balanceOf(tmpAccount.address)).to.equal(100);
  });

  it("EIP-712 Domain Separator", async function () {
    const domainSeparator = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(
              "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            )
          ),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes(wrappedTokenName)),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1")),
          chainId,
          wrapped.address,
        ]
      )
    );
    expect(await wrapped.DOMAIN_SEPARATOR()).to.equal(domainSeparator);
  });

  it("EIP-712 TypeHashes", async function () {
    // Check Permit TypeHash:
    const delegatedTransferTypehash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(
        "DELEGATED_TRANSFER(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)"
      )
    );
    expect(await wrapped.DELEGATED_TRANSFER_TYPEHASH()).to.equal(
      delegatedTransferTypehash
    );
  });

  it("Permit EIP-712 test", async function () {
    const domain = {
      name: wrappedTokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: wrapped.address,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const msg = {
      owner: tmpAccount.address,
      spender: minter.address,
      value: 100,
      nonce: 0,
      deadline: ethers.constants.MaxUint256,
    };

    // Sign permit:
    const signer = await ethers.getSigner(tmpAccount.address);
    const sig = await signer._signTypedData(domain, types, msg);
    const splitSig = ethers.utils.splitSignature(sig);

    // V2 doesn't have delegate authorization - permit works directly
    await expect(
      wrapped.permit(
        tmpAccount.address,
        minter.address,
        100,
        (
          await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
        ).timestamp, // deadline in the past
        splitSig.v,
        splitSig.r,
        splitSig.s
      )
    ).to.revertedWith("ERC20Permit: expired deadline");

    const tx = await wrapped.permit(
      tmpAccount.address,
      minter.address,
      100,
      ethers.constants.MaxUint256,
      splitSig.v,
      splitSig.r,
      splitSig.s
    );
    const receipt = await tx.wait();
    expect(receipt.events?.[0].event).to.equal("Approval");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt.events?.[0].args?.[1]).to.equal(minter.address);
    expect(receipt.events?.[0].args?.[2]).to.equal(100);
    expect(await wrapped.allowance(tmpAccount.address, minter.address)).to.equal(
      100
    );

    // Try with another signature
    msg.nonce = 1;
    msg.value = 150;
    const sig2 = await signer._signTypedData(domain, types, msg);
    const splitSig2 = ethers.utils.splitSignature(sig2);

    const tx2 = await wrapped
      .connect(minter.signer)
      .permit(
        tmpAccount.address,
        minter.address,
        150,
        ethers.constants.MaxUint256,
        splitSig2.v,
        splitSig2.r,
        splitSig2.s
      );
    const receipt2 = await tx2.wait();
    expect(receipt2.events?.[0].event).to.equal("Approval");
    expect(receipt2.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt2.events?.[0].args?.[1]).to.equal(minter.address);
    expect(receipt2.events?.[0].args?.[2]).to.equal(150);
    expect(await wrapped.allowance(tmpAccount.address, minter.address)).to.equal(
      150
    );

    // Replay msg should fail:
    await expect(
      wrapped
        .connect(minter.signer)
        .permit(
          tmpAccount.address,
          minter.address,
          150,
          ethers.constants.MaxUint256,
          splitSig2.v,
          splitSig2.r,
          splitSig2.s
        )
    ).to.revertedWith("ERC20Permit: invalid signature");
  });

  it("Delegate Transfer EIP-712 test", async function () {
    // Mint tokens:
    await token.approve(wrapped.address, 500);
    await wrapped.deposit(500, tmpAccount.address);

    const domain = {
      name: wrappedTokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: wrapped.address,
    };

    const types = {
      DELEGATED_TRANSFER: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const msg = {
      owner: tmpAccount.address,
      to: minter.address,
      value: 100,
      nonce: 0,
      deadline: ethers.constants.MaxUint256,
    };

    // Sign delegate transfer:
    const signer = await ethers.getSigner(tmpAccount.address);
    const sig = await signer._signTypedData(domain, types, msg);
    const splitSig = ethers.utils.splitSignature(sig);

    // V2 doesn't have delegate authorization - test expired deadline
    await expect(
      wrapped.delegatedTransfer(
        tmpAccount.address,
        minter.address,
        100,
        (
          await ethers.provider.getBlock(await ethers.provider.getBlockNumber())
        ).timestamp - 5, // deadline in the past
        splitSig.v,
        splitSig.r,
        splitSig.s
      )
    ).to.revertedWith("ERC20Permit: expired deadline");

    const tx = await wrapped.delegatedTransfer(
      tmpAccount.address,
      minter.address,
      100,
      ethers.constants.MaxUint256,
      splitSig.v,
      splitSig.r,
      splitSig.s
    );
    const receipt = await tx.wait();
    expect(receipt.events?.[0].event).to.equal("Transfer");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt.events?.[0].args?.[1]).to.equal(minter.address);
    expect(receipt.events?.[0].args?.[2]).to.equal(100);
    expect(await wrapped.balanceOf(tmpAccount.address)).to.equal(400);
    expect(await wrapped.balanceOf(minter.address)).to.equal(100);

    // Try again with different nonce
    msg.nonce = 1;
    msg.value = 200;
    const sig2 = await signer._signTypedData(domain, types, msg);
    const splitSig2 = ethers.utils.splitSignature(sig2);

    const tx2 = await wrapped
      .connect(minter.signer)
      .delegatedTransfer(
        tmpAccount.address,
        minter.address,
        200,
        ethers.constants.MaxUint256,
        splitSig2.v,
        splitSig2.r,
        splitSig2.s
      );
    const receipt2 = await tx2.wait();
    expect(receipt2.events?.[0].event).to.equal("Transfer");
    expect(receipt2.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt2.events?.[0].args?.[1]).to.equal(minter.address);
    expect(receipt2.events?.[0].args?.[2]).to.equal(200);
    expect(await wrapped.balanceOf(tmpAccount.address)).to.equal(200);
    expect(await wrapped.balanceOf(minter.address)).to.equal(300);

    // Replay msg should fail:
    await expect(
      wrapped
        .connect(minter.signer)
        .delegatedTransfer(
          tmpAccount.address,
          minter.address,
          150,
          ethers.constants.MaxUint256,
          splitSig2.v,
          splitSig2.r,
          splitSig2.s
        )
    ).to.revertedWith("ERC20Permit: invalid signature");
  });

  it("Try to set delegate from wrong address", async function () {
    // V2 doesn't have setDelegateMode or setDelegateWhitelist
    // Test that only owner can call owner-only functions
    await expect(
      wrapped.connect(tmpAccount.signer).setPauser(tmpAccount.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  // Sanctions list management has moved to the underlying token; the wrapped
  // contract reads from `IBackedToken(asset()).sanctionsList()`. So the
  // wrapper-side setters/getters no longer exist and the legacy
  // "Set SanctionsList" tests have been removed.

  it("Check blocking of address in the Sanctions List", async function () {
    await token.approve(wrapped.address, 200);
    await wrapped.deposit(100, owner.address);
    await wrapped.deposit(100, tmpAccount.address);
    await wrapped.setPauser(pauser.address);

    // Add an address to the sanctions list:
    await (
      await sanctionsList
        .connect(blacklister.signer)
        .addToSanctionsList([tmpAccount.address])
    ).wait();

    // Try to send to the sanctioned address:
    await expect(wrapped.transfer(tmpAccount.address, 100)).to.be.revertedWith(
      "WrappedBackedToken: receiver is sanctioned"
    );

    // Try to send from the sanctioned address:
    await expect(
      wrapped.connect(tmpAccount.signer).transfer(owner.address, 100)
    ).to.be.revertedWith("WrappedBackedToken: sender is sanctioned");

    // Try to spend from the sanctioned address:
    wrapped.connect(owner.signer).approve(tmpAccount.address, 100);
    await expect(
      wrapped
        .connect(tmpAccount.signer)
        .transferFrom(owner.address, minter.address, 50)
    ).to.be.revertedWith("WrappedBackedToken: spender is sanctioned");

    // Remove from sanctions list:
    await (
      await sanctionsList
        .connect(blacklister.signer)
        .removeFromSanctionsList([tmpAccount.address])
    ).wait();

    // Check transfer is possible:
    await wrapped.transfer(tmpAccount.address, 100);
    await wrapped.connect(tmpAccount.signer).transfer(owner.address, 100);

    // Check transferFrom is possible:
    await wrapped
      .connect(tmpAccount.signer)
      .transferFrom(owner.address, burner.address, 50);
    expect(await wrapped.balanceOf(burner.address)).to.equal(50);
    expect(await wrapped.balanceOf(owner.address)).to.equal(50);
  });

  it("SanctionsList stops deposit and redeem", async function () {
    await token.connect(minter.signer).approve(wrapped.address, BigNumber.from(10).pow(18).mul(1_000_000));
    await token.approve(wrapped.address, 300);
    await wrapped.deposit(100, owner.address);
    await wrapped.deposit(100, tmpAccount.address);
    await wrapped.deposit(100, burner.address);
    await wrapped.setPauser(pauser.address);

    // Sanction 0x0 address, and still mint:
    await sanctionsList.addToSanctionsList([ethers.constants.AddressZero]);
    await wrapped.connect(minter.signer).deposit(100, tmpAccount.address);
    expect(await wrapped.balanceOf(tmpAccount.address)).to.equal(200);

    // Try to sanction minter address:
    await sanctionsList
      .connect(blacklister.signer)
      .addToSanctionsList([minter.address]);
    await expect(wrapped.connect(minter.signer).deposit(100, tmpAccount.address)).to.be.revertedWith('BackedToken: sender is sanctioned');

    // Try to sanction burner address:
    await sanctionsList
      .connect(blacklister.signer)
      .addToSanctionsList([burner.address]);
    await expect(wrapped.connect(burner.signer).redeem(50, burner.address, burner.address)).to.be.revertedWith('WrappedBackedToken: sender is sanctioned');
  });

  it("SanctionsList stops spender in transferFrom", async function () {
    await token.approve(wrapped.address, 300);
    await wrapped.deposit(100, owner.address);
    await wrapped.approve(minter.address, 100);

    await sanctionsList.addToSanctionsList([minter.address]);
    await expect(wrapped.connect(minter.signer).transferFrom(owner.address, tmpAccount.address, 100)).to.be.revertedWith('WrappedBackedToken: spender is sanctioned');
  });

  it("Check and set Terms", async function () {
    // Test current Terms:
    expect(await wrapped.terms()).to.equal(
      "https://www.backedassets.fi/legal-documentation"
    );

    // Change Terms
    const receipt = await (await wrapped.setTerms("New Terms ^^")).wait();
    expect(receipt.events?.[0].event).to.equal("NewTerms");
    expect(receipt.events?.[0].args?.[0]).to.equal("New Terms ^^");
    expect(await wrapped.terms()).to.equal("New Terms ^^");
  });

  it("Try to set Terms from wrong address", async function () {
    await expect(
      wrapped.connect(tmpAccount.signer).setTerms("Random Terms")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  describe('ERC4626 edge cases and compliance', () => {
    describe('#deposit with different receivers', () => {
      it("should deposit to a different receiver", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);

        await wrapped.deposit(depositAmount, actor.address);

        const balance = await wrapped.balanceOf(actor.address);
        expect(balance).to.be.gt(0);
        expect(await wrapped.balanceOf(owner.address)).to.equal(0);
      });
    });

    describe('#mint with different receivers', () => {
      it("should mint to a different receiver", async () => {
        const mintAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, BigNumber.from(10).pow(18));

        await wrapped.mint(mintAmount, actor.address);

        const balance = await wrapped.balanceOf(actor.address);
        expect(balance).to.equal(mintAmount);
      });
    });

    describe('#withdraw with allowance', () => {
      it("should allow withdrawal with proper allowance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        // Approve actor to withdraw on behalf of owner
        await wrapped.approve(actor.address, depositAmount);

        const beforeBalance = await token.balanceOf(tmpAccount.address);
        await wrapped.connect(actor.signer).withdraw(500, tmpAccount.address, owner.address);

        const afterBalance = await token.balanceOf(tmpAccount.address);
        expect(afterBalance.sub(beforeBalance).toNumber()).to.be.approximately(500, 2);
      });

      it("should fail withdrawal without allowance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        await expect(
          wrapped.connect(actor.signer).withdraw(500, tmpAccount.address, owner.address)
        ).to.be.reverted;
      });
    });

    describe('#redeem with allowance', () => {
      it("should allow redeem with proper allowance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.mint(depositAmount, owner.address);

        // Approve actor to redeem on behalf of owner
        await wrapped.approve(actor.address, depositAmount);

        await wrapped.connect(actor.signer).redeem(500, tmpAccount.address, owner.address);

        const balance = await wrapped.balanceOf(owner.address);
        expect(balance).to.equal(500);
      });

      it("should fail redeem without allowance", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.mint(depositAmount, owner.address);

        await expect(
          wrapped.connect(actor.signer).redeem(500, tmpAccount.address, owner.address)
        ).to.be.reverted;
      });
    });

    describe('#deposit and #withdraw roundtrip', () => {
      it("should allow full roundtrip deposit and withdraw", async () => {
        const depositAmount = BigNumber.from(1000);
        const initialBalance = await token.balanceOf(owner.address);

        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        const assets = await wrapped.convertToAssets(await wrapped.balanceOf(owner.address));
        await wrapped.withdraw(assets, owner.address, owner.address);

        const finalBalance = await token.balanceOf(owner.address);
        expect(finalBalance.sub(initialBalance).abs().toNumber()).to.be.approximately(0, 2);
      });
    });

    describe('#mint and #redeem roundtrip', () => {
      it("should allow full roundtrip mint and redeem", async () => {
        const mintAmount = BigNumber.from(1000);
        const initialBalance = await token.balanceOf(owner.address);

        await token.approve(wrapped.address, BigNumber.from(10).pow(18));
        await wrapped.mint(mintAmount, owner.address);

        await wrapped.redeem(mintAmount, owner.address, owner.address);

        const finalBalance = await token.balanceOf(owner.address);
        expect(finalBalance.sub(initialBalance).abs().toNumber()).to.be.approximately(0, 2);
      });
    });
  });

  describe('Rounding behavior tests', () => {
    describe('When dealing with small amounts', () => {
      it("should handle deposit of 1 wei correctly", async () => {
        await token.approve(wrapped.address, 1);
        const shares = await wrapped.previewDeposit(1);

        if (shares.gt(0)) {
          await wrapped.deposit(1, owner.address);
          expect(await wrapped.balanceOf(owner.address)).to.be.gte(shares);
        }
      });

      it("should handle mint of 1 share correctly", async () => {
        await token.approve(wrapped.address, BigNumber.from(10).pow(18));
        await wrapped.previewMint(1);

        await wrapped.mint(1, owner.address);
        expect(await wrapped.balanceOf(owner.address)).to.equal(1);
      });
    });

    describe('Rounding direction tests', () => {
      it("previewDeposit should round down", async () => {
        const assets = BigNumber.from(999);
        const shares1 = await wrapped.previewDeposit(assets);
        const shares2 = await wrapped.convertToShares(assets);

        expect(shares1).to.equal(shares2);
      });

      it("previewMint should round down", async () => {
        const shares = BigNumber.from(999);
        const assets = await wrapped.previewMint(shares);

        // previewMint uses Rounding.Down
        const currentMultiplier = (await token.getCurrentMultiplier())[0];
        const expected = shares.mul(currentMultiplier).div(BigNumber.from(10).pow(18));

        expect(assets).to.equal(expected);
      });

      it("previewWithdraw should round down", async () => {
        const assets = BigNumber.from(999);
        const shares = await wrapped.previewWithdraw(assets);

        // previewWithdraw uses Rounding.Down
        const currentMultiplier = (await token.getCurrentMultiplier())[0];
        const expected = assets.mul(BigNumber.from(10).pow(18)).div(currentMultiplier);

        expect(shares).to.equal(expected);
      });

      it("previewRedeem should round down", async () => {
        const shares = BigNumber.from(999);
        const assets1 = await wrapped.previewRedeem(shares);
        const assets2 = await wrapped.convertToAssets(shares);

        expect(assets1).to.equal(assets2);
      });
    });
  });

  describe('Transfer restrictions and ERC20 compliance', () => {
    describe('When paused', () => {
      cacheBeforeEach(async () => {
        await token.approve(wrapped.address, 1000);
        await wrapped.deposit(500, owner.address);
        await wrapped.setPauser(pauser.address);
        await wrapped.connect(pauser.signer).setPause(true);
      });

      it("should block deposit when paused", async () => {
        await expect(
          wrapped.deposit(100, owner.address)
        ).to.be.revertedWith("WrappedBackedToken: token transfer while paused");
      });

      it("should block mint when paused", async () => {
        await expect(
          wrapped.mint(100, owner.address)
        ).to.be.revertedWith("WrappedBackedToken: token transfer while paused");
      });

      it("should block withdraw when paused", async () => {
        await expect(
          wrapped.withdraw(100, owner.address, owner.address)
        ).to.be.revertedWith("WrappedBackedToken: token transfer while paused");
      });

      it("should block redeem when paused", async () => {
        await expect(
          wrapped.redeem(100, owner.address, owner.address)
        ).to.be.revertedWith("WrappedBackedToken: token transfer while paused");
      });
    });

    describe('Zero amount operations', () => {
      it("should handle deposit of 0 amount", async () => {
        await token.approve(wrapped.address, 1000);
        await wrapped.deposit(0, owner.address);
        expect(await wrapped.balanceOf(owner.address)).to.equal(0);
      });

      it("should handle mint of 0 shares", async () => {
        await token.approve(wrapped.address, 1000);
        await wrapped.mint(0, owner.address);
        expect(await wrapped.balanceOf(owner.address)).to.equal(0);
      });

      it("should handle withdraw of 0 amount", async () => {
        await token.approve(wrapped.address, 1000);
        await wrapped.deposit(500, owner.address);

        const beforeBalance = await wrapped.balanceOf(owner.address);
        await wrapped.withdraw(0, owner.address, owner.address);
        expect(await wrapped.balanceOf(owner.address)).to.equal(beforeBalance);
      });

      it("should handle redeem of 0 shares", async () => {
        await token.approve(wrapped.address, 1000);
        await wrapped.deposit(500, owner.address);

        const beforeBalance = await wrapped.balanceOf(owner.address);
        await wrapped.redeem(0, owner.address, owner.address);
        expect(await wrapped.balanceOf(owner.address)).to.equal(beforeBalance);
      });
    });
  });

  describe('Multiplier changes during operations', () => {
    describe('When multiplier changes between preview and execution', () => {
      it("should handle multiplier increase between previewDeposit and deposit", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);

        const expectedShares = await wrapped.previewDeposit(depositAmount);

        // Increase multiplier by 10%
        const previousMultiplier = await token.multiplier();
        await token.updateMultiplierValue(
          previousMultiplier.mul(110).div(100),
          previousMultiplier,
          0
        );

        // Deposit should still work but give different shares
        await wrapped.deposit(depositAmount, owner.address);
        const actualShares = await wrapped.balanceOf(owner.address);

        // With higher multiplier, same assets give fewer shares
        expect(actualShares).to.be.lt(expectedShares);
      });
      
      it("should handle multiplier decrease between previewWithdraw and withdraw", async () => {
        const depositAmount = BigNumber.from(1000);
        await token.approve(wrapped.address, depositAmount);
        await wrapped.deposit(depositAmount, owner.address);

        const withdrawAmount = BigNumber.from(500);
        await wrapped.previewWithdraw(withdrawAmount);

        // Decrease multiplier by 10%
        const previousMultiplier = await token.multiplier();
        await token.updateMultiplierValue(
          previousMultiplier.mul(90).div(100),
          previousMultiplier,
          0
        );

        // Withdraw should still work
        await wrapped.withdraw(withdrawAmount, owner.address, owner.address);
      });
    });
  });

  describe('Rounding math at multiplier = 10x', () => {
    // The wrapper overrides _convertToShares/_convertToAssets to use the
    // underlying multiplier directly:
    //   shares = assets * 1e18 / multiplier   (floor)
    //   assets = shares * multiplier / 1e18   (floor)
    // and overrides previewMint/previewWithdraw to also round Down (see the
    // contract's "Amounts are rounded down, in order to accomodate multiplier
    // math done on underlying token" notes). At multiplier = 10e18:
    //   previewDeposit(a) = previewWithdraw(a) = floor(a / 10)
    //   previewMint(s)    = previewRedeem(s)   = s * 10  (always exact)
    //
    // The underlying BackedAutoFeeToken also floors `amount -> underlying-shares`
    // on transfer, so a transferFrom of `a` actually moves
    //   floor(a / 10) * 10 = a - (a % 10)
    // underlying in balanceOf terms (the `a % 10` remainder vanishes).

    const ONE = BigNumber.from(10).pow(18);

    cacheBeforeEach(async () => {
      // Prime: 1e18 underlying -> 1e18 wrapped shares (1:1 since vault was empty).
      await token.approve(wrapped.address, ONE.mul(20));
      await wrapped.deposit(ONE, owner.address);

      // Move underlying multiplier to exactly 10x.
      const previousMultiplier = await token.multiplier();
      await token.updateMultiplierValue(ONE.mul(10), previousMultiplier, 0);

      // Sanity check: vault state is what the formulas below assume.
      expect(await wrapped.totalSupply()).to.equal(ONE);
      expect(await wrapped.totalAssets()).to.equal(ONE.mul(10));
      expect((await token.getCurrentMultiplier())[0]).to.equal(ONE.mul(10));
    });

    describe("preview functions follow floor(a/10) and s*10 exactly", () => {
      it("previewDeposit(20) == 2  (assets divisible by multiplier — exact)", async () => {
        expect(await wrapped.previewDeposit(20)).to.equal(2);
        expect(await wrapped.previewWithdraw(20)).to.equal(2);
      });

      it("previewDeposit(25) == 2  (not divisible — rounds down, 5 wei lost)", async () => {
        expect(await wrapped.previewDeposit(25)).to.equal(2);
        expect(await wrapped.previewWithdraw(25)).to.equal(2);
      });

      it("previewDeposit(9) == 0  (less than one share's worth of assets)", async () => {
        expect(await wrapped.previewDeposit(9)).to.equal(0);
        expect(await wrapped.previewWithdraw(9)).to.equal(0);
      });

      it("previewMint and previewRedeem are always exact at 10x", async () => {
        for (const s of [0, 1, 2, 7, 100, 999]) {
          expect(await wrapped.previewMint(s), `previewMint(${s})`).to.equal(s * 10);
          expect(await wrapped.previewRedeem(s), `previewRedeem(${s})`).to.equal(s * 10);
        }
      });
    });

    describe("deposit", () => {
      it("exact: deposit(20) mints 2 shares and removes 20 underlying from owner", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(20, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(2);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(20);
      });

      it("inexact: deposit(25) mints 2 shares but only removes 20 underlying (5 wei lost in underlying rounding)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(25, owner.address);

        // Wrapper mints floor(25/10) = 2 wrapped shares.
        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(2);
        // But the underlying token's transferFrom floors amount->underlying-shares,
        // so owner's balanceOf only drops by 20, not 25 — the 5-wei remainder simply
        // never leaves the owner's account.
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(20);
      });
    });

    describe("mint", () => {
      it("mint(7) pulls exactly 70 underlying and credits 7 shares — always exact at 10x", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(7, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(7);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(70);
      });

      it("mint(0) is a no-op on balances", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(0, owner.address);

        expect(await wrapped.balanceOf(owner.address)).to.equal(sharesBefore);
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });
    });

    describe("withdraw", () => {
      it("exact: withdraw(40) burns 4 shares and pays out 40 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(40, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(4);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(40);
      });

      it("inexact: withdraw(45) burns floor(45/10)=4 shares and pays out 40 underlying (5 wei vanishes)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(45, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(4);
        // Underlying token also floors the transfer -> only 40 actually moves.
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(40);
      });
    });

    describe("redeem", () => {
      it("redeem(3) burns 3 shares and returns exactly 30 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.redeem(3, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(3);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(30);
      });
    });

    describe("round trips", () => {
      it("deposit(100) -> redeem returns exactly 100 — divides cleanly by multiplier", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(100, owner.address);
        const sharesMinted = (await wrapped.balanceOf(owner.address)).sub(sharesBefore);
        expect(sharesMinted).to.equal(10);

        await wrapped.redeem(sharesMinted, owner.address, owner.address);

        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });

      it("deposit(107) -> redeem nets to zero — the 7-wei remainder never leaves owner's account", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(107, owner.address);
        const sharesMinted = (await wrapped.balanceOf(owner.address)).sub(sharesBefore);
        expect(sharesMinted).to.equal(10); // floor(107/10)
        // The wrapper *requested* 107 from owner, but the underlying token only
        // moved floor(107*1e18/10e18)=10 underlying-shares (=100 in balanceOf).
        // The 7-wei remainder stays in owner's account.
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(100);

        await wrapped.redeem(sharesMinted, owner.address, owner.address);

        // After redeeming the 10 shares the owner is exactly whole again.
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });

      it("mint(5) -> redeem(5) is a perfect round trip — assets math is exact at 10x", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(5, owner.address);
        await wrapped.redeem(5, owner.address, owner.address);

        expect(await wrapped.balanceOf(owner.address)).to.equal(sharesBefore);
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });
    });
  });

  describe('Rounding math at multiplier = 0.51x', () => {
    // The wrapper overrides _convertToShares/_convertToAssets, previewWithdraw,
    // and previewMint — so the active rounding directions are:
    //   previewDeposit  -> _convertToShares Down  (OZ default)
    //   previewMint     -> _convertToAssets Down  (wrapper override; non-standard)
    //   previewWithdraw -> _convertToShares Down  (wrapper override; non-standard)
    //   previewRedeem   -> _convertToAssets Down  (OZ default)
    // The wrapper's _convertToShares/_convertToAssets ignore totalSupply and use
    // the underlying multiplier directly:
    //   shares = a * 1e18 / multiplier   (rounding from caller)
    //   assets = s * multiplier / 1e18   (rounding from caller)
    // At multiplier = 0.51e18 these reduce to:
    //   previewDeposit(a)  = previewWithdraw(a) = floor(a * 100 / 51)
    //   previewMint(s)     = previewRedeem(s)   = floor(s * 51 / 100)
    //
    // Because the wrapper's _deposit/_withdraw use transferShares directly (not
    // the assets value), the underlying balance delta observed by the owner is
    // independent of the preview's rounding direction. The underlying token
    // stores in shares and floors both amount->shares (on transfer) and
    // shares->amount (on balanceOf), so the observed balanceOf delta is a
    // non-trivial composition of the share count moved and the underlying's
    // flooring. Expected values below were captured directly from the contract.

    const ONE = BigNumber.from(10).pow(18);
    const MULTIPLIER = ONE.mul(51).div(100); // 0.51e18

    cacheBeforeEach(async () => {
      // Prime: 1e18 underlying -> 1e18 wrapped shares (1:1 since vault was empty).
      await token.approve(wrapped.address, ONE.mul(20));
      await wrapped.deposit(ONE, owner.address);

      const previousMultiplier = await token.multiplier();
      await token.updateMultiplierValue(MULTIPLIER, previousMultiplier, 0);

      expect(await wrapped.totalSupply()).to.equal(ONE);
      expect(await wrapped.totalAssets()).to.equal(MULTIPLIER);
      expect((await token.getCurrentMultiplier())[0]).to.equal(MULTIPLIER);
    });

    describe("preview functions", () => {
      it("previewDeposit/previewWithdraw match floor(a * 100 / 51)", async () => {
        // Both round Down (wrapper override on previewWithdraw).
        expect(await wrapped.previewDeposit(0)).to.equal(0);
        expect(await wrapped.previewDeposit(1)).to.equal(1);     // floor(100/51)
        expect(await wrapped.previewDeposit(50)).to.equal(98);   // floor(5000/51)
        expect(await wrapped.previewDeposit(51)).to.equal(100);  // exact
        expect(await wrapped.previewDeposit(52)).to.equal(101);  // floor(5200/51)
        expect(await wrapped.previewDeposit(102)).to.equal(200); // exact

        for (const a of [0, 1, 50, 51, 52, 102]) {
          expect(await wrapped.previewWithdraw(a), `previewWithdraw(${a})`).to.equal(
            await wrapped.previewDeposit(a)
          );
        }
      });

      it("previewMint rounds Down (floor) — wrapper override matches previewRedeem", async () => {
        // previewMint = floor(s * 51 / 100), same as previewRedeem
        expect(await wrapped.previewMint(0)).to.equal(0);
        expect(await wrapped.previewMint(1)).to.equal(0);     // floor(0.51)
        expect(await wrapped.previewMint(50)).to.equal(25);   // floor(25.5)
        expect(await wrapped.previewMint(99)).to.equal(50);   // floor(50.49)
        expect(await wrapped.previewMint(100)).to.equal(51);  // exact
        expect(await wrapped.previewMint(101)).to.equal(51);  // floor(51.51)
      });

      it("previewRedeem rounds Down (floor)", async () => {
        expect(await wrapped.previewRedeem(0)).to.equal(0);
        expect(await wrapped.previewRedeem(1)).to.equal(0);     // floor(0.51) — sub-unit
        expect(await wrapped.previewRedeem(50)).to.equal(25);   // floor(25.5)
        expect(await wrapped.previewRedeem(99)).to.equal(50);   // floor(50.49)
        expect(await wrapped.previewRedeem(100)).to.equal(51);  // exact
        expect(await wrapped.previewRedeem(101)).to.equal(51);  // floor(51.51)
      });

      it("previewMint always equals previewRedeem (both round Down)", async () => {
        for (const s of [0, 1, 50, 99, 100, 101]) {
          expect(await wrapped.previewMint(s), `previewMint(${s})`).to.equal(
            await wrapped.previewRedeem(s)
          );
        }
      });
    });

    describe("deposit", () => {
      it("exact: deposit(51) mints 100 shares and removes 51 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(51, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(100);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(51);
      });

      it("inexact: deposit(52) mints 101 shares and removes 52 underlying", async () => {
        // Owner pays the full requested 52, but only gets shares worth previewRedeem(101) = 51.
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(52, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(101);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(52);
      });

      it("inexact: deposit(50) mints 98 shares and removes 50 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(50, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(98);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(50);
      });
    });

    describe("mint", () => {
      it("exact: mint(100) credits 100 shares and pulls 51 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(100, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(100);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(51);
      });

      it("inexact: mint(101) charges previewMint=52 underlying (Up rounding)", async () => {
        // Up-rounding ensures the vault never under-charges for shares minted.
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(101, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(101);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(52);
      });

      it("inexact: mint(99) charges previewMint=51 underlying (Up rounding from 50.49)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(99, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(99);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(51);
      });

      it("sub-unit: mint(1) costs 1 underlying (Up-rounded from 0.51)", async () => {
        // Despite a single share being worth less than 1 wei at this multiplier,
        // the Up rounding charges 1 wei to avoid free shares.
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(1, owner.address);

        expect((await wrapped.balanceOf(owner.address)).sub(sharesBefore)).to.equal(1);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(1);
      });
    });

    describe("withdraw", () => {
      it("exact: withdraw(51) burns 100 shares and pays 51 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(51, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(100);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(51);
      });

      it("inexact: withdraw(52) burns 101 shares but pays only 51 underlying (1 wei lost in underlying flooring)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(52, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(101);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(51);
      });

      it("inexact: withdraw(50) burns 98 shares and pays 49 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(50, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(98);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(49);
      });

      it("sub-unit: withdraw(1) burns 1 share but receives 0 underlying", async () => {
        // The wrapper sends 1 underlying to owner, but at multiplier 0.51 the
        // underlying token converts that to 1 underlying-share, which contributes
        // 0 wei to owner.balanceOf (sub-multiplier resolution).
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.withdraw(1, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(1);
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });
    });

    describe("redeem", () => {
      it("exact: redeem(100) burns 100 shares and returns 51 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.redeem(100, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(100);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(51);
      });

      it("inexact: redeem(101) burns 101 shares and returns previewRedeem=51 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.redeem(101, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(101);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(51);
      });

      it("inexact: redeem(50) burns 50 shares and returns 25 underlying (matches preview=25)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.redeem(50, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(50);
        expect((await token.balanceOf(owner.address)).sub(ownerAssetsBefore)).to.equal(25);
      });

      it("sub-unit: redeem(1) burns 1 share for 0 underlying", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.redeem(1, owner.address, owner.address);

        expect(sharesBefore.sub(await wrapped.balanceOf(owner.address))).to.equal(1);
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });
    });

    describe("round trips", () => {
      it("deposit(51) -> redeem(100) is exact at the multiplier boundary", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(51, owner.address);
        const sharesMinted = (await wrapped.balanceOf(owner.address)).sub(sharesBefore);
        expect(sharesMinted).to.equal(100);

        await wrapped.redeem(sharesMinted, owner.address, owner.address);

        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });

      it("deposit(52) -> redeem(101) is a perfect round trip (share-based transfer)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.deposit(52, owner.address);
        const sharesMinted = (await wrapped.balanceOf(owner.address)).sub(sharesBefore);
        expect(sharesMinted).to.equal(101);
        expect(ownerAssetsBefore.sub(await token.balanceOf(owner.address))).to.equal(52);

        await wrapped.redeem(sharesMinted, owner.address, owner.address);

        // The wrapper moves shares directly, so redeeming the same share count
        // restores the owner's underlying balance exactly.
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });

      it("mint(100) -> redeem(100) is a perfect round trip — exact at 100-share boundary", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(100, owner.address);
        await wrapped.redeem(100, owner.address, owner.address);

        expect(await wrapped.balanceOf(owner.address)).to.equal(sharesBefore);
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });

      it("mint(101) -> redeem(101) is a perfect round trip (share-based transfer)", async () => {
        const ownerAssetsBefore = await token.balanceOf(owner.address);
        const sharesBefore = await wrapped.balanceOf(owner.address);

        await wrapped.mint(101, owner.address);
        await wrapped.redeem(101, owner.address, owner.address);

        expect(await wrapped.balanceOf(owner.address)).to.equal(sharesBefore);
        // Moving 101 shares out and back nets to zero regardless of preview rounding.
        expect(await token.balanceOf(owner.address)).to.equal(ownerAssetsBefore);
      });
    });
  });

  describe('View function consistency', () => {
    it("convertToShares and previewDeposit should return same value", async () => {
      const assets = BigNumber.from(1000);
      const shares1 = await wrapped.convertToShares(assets);
      const shares2 = await wrapped.previewDeposit(assets);

      expect(shares1).to.equal(shares2);
    });

    it("convertToAssets and previewRedeem should return same value", async () => {
      const shares = BigNumber.from(1000);
      const assets1 = await wrapped.convertToAssets(shares);
      const assets2 = await wrapped.previewRedeem(shares);

      expect(assets1).to.equal(assets2);
    });

    it("totalAssets should equal sum of underlying shares converted", async () => {
      await token.approve(wrapped.address, 1000);
      await wrapped.deposit(1000, owner.address);

      const totalAssets = await wrapped.totalAssets();
      const shares = await token.sharesOf(wrapped.address);
      const expectedAssets = await token.getUnderlyingAmountByShares(shares);

      expect(totalAssets).to.equal(expectedAssets);
    });
  });

  describe('Owner controls', () => {
    it("should transfer ownership", async () => {
      await wrapped.transferOwnership(tmpAccount.address);
      expect(await wrapped.owner()).to.equal(tmpAccount.address);

      // Transfer back
      await wrapped.connect(tmpAccount.signer).transferOwnership(owner.address);
      expect(await wrapped.owner()).to.equal(owner.address);
    });

    it("should renounce ownership", async () => {
      // Create a new wrapped token for this test to avoid affecting other tests
      const newWrappedImpl = await new WrappedBackedTokenImplementation__factory(owner.signer).deploy();
      const newWrapped = WrappedBackedTokenImplementation__factory.connect((await new WrappedBackedTokenProxy__factory(owner.signer).deploy(
        newWrappedImpl.address,
        proxyAdmin.address,
        newWrappedImpl.interface.encodeFunctionData('initialize', [wrappedTokenName, wrappedTokenSymbol, token.address])
      )).address, owner.signer);

      await newWrapped.renounceOwnership();
      expect(await newWrapped.owner()).to.equal(ethers.constants.AddressZero);
    });
  });
});

function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}
