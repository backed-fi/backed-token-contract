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
    await wrapped.setSanctionsList(sanctionsList.address);


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

    await expect(
      wrapped.connect(tmpAccount.signer).setSanctionsList(tmpAccount.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Set SanctionsList", async function () {
    // Deploy a new Sanctions List:
    const sanctionsList2: SanctionsListMock = await (
      await ethers.getContractFactory("SanctionsListMock", blacklister.signer)
    ).deploy();
    await sanctionsList2.deployed();

    // Test current Sanctions List:
    expect(await wrapped.sanctionsList()).to.equal(sanctionsList.address);

    // Change SanctionsList
    const receipt = await (
      await wrapped.setSanctionsList(sanctionsList2.address)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("NewSanctionsList");
    expect(receipt.events?.[0].args?.[0]).to.equal(sanctionsList2.address);
    expect(await wrapped.sanctionsList()).to.equal(sanctionsList2.address);
  });

  it("Try to set SanctionsList from wrong address", async function () {
    await expect(
      wrapped.connect(tmpAccount.signer).setSanctionsList(tmpAccount.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Try to set SanctionsList to a contract not following the interface", async function () {
    await expect(
      wrapped.connect(owner.signer).setSanctionsList(wrapped.address)
    ).to.be.revertedWith(
      "Transaction reverted: function selector was not recognized and there's no fallback function"
    );
  });

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
    await wrapped.setSanctionsList(sanctionsList.address);

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
