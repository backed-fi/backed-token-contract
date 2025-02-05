/* eslint-disable camelcase */
/* eslint-disable prettier/prettier */
import { ProxyAdmin__factory } from '../typechain/factories/ProxyAdmin__factory';
import { ProxyAdmin } from '../typechain/ProxyAdmin';
import { BackedAutoFeeTokenImplementation__factory } from '../typechain/factories/BackedAutoFeeTokenImplementation__factory';
import { BackedAutoFeeTokenImplementation } from '../typechain/BackedAutoFeeTokenImplementation';
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  BackedTokenImplementation__factory,
  BackedTokenProxy,
  BackedTokenProxy__factory,
  SanctionsListMock,
  SanctionsListMock__factory,
  WrappedBackedTokenImplementation,
  WrappedBackedTokenImplementation__factory,
  WrappedBackedTokenProxy__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { cacheBeforeEach } from "./helpers";
import Decimal from 'decimal.js';

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
          previousMultiplier
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
  });



  // Tests copied from base BackedTokenImplementation tests:

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
    // ToDo:
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

    // Try to send it when delegation mode is off:
    await expect(
      wrapped.permit(
        tmpAccount.address,
        minter.address,
        100,
        ethers.constants.MaxUint256,
        splitSig.v,
        splitSig.r,
        splitSig.s
      )
    ).to.revertedWith("BackedToken: Unauthorized delegate");

    // Whitelist an address and relay signature:
    await wrapped.setDelegateWhitelist(owner.address, true);

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

    // Set delegation mode to true and try again:
    await wrapped.setDelegateMode(true);
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

    // Try to send it when delegation mode is off:
    await expect(
      wrapped.delegatedTransfer(
        tmpAccount.address,
        minter.address,
        100,
        ethers.constants.MaxUint256,
        splitSig.v,
        splitSig.r,
        splitSig.s
      )
    ).to.revertedWith("WrappedBackedToken: Unauthorized delegate");

    // Whitelist an address and relay signature:
    await wrapped.setDelegateWhitelist(owner.address, true);

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

    // Set delegation mode to true and try again:
    await wrapped.setDelegateMode(true);
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
    // Delegate mode:
    await expect(
      wrapped.connect(tmpAccount.signer).setDelegateMode(true)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Delegate address:
    await expect(
      wrapped
        .connect(tmpAccount.signer)
        .setDelegateWhitelist(tmpAccount.address, true)
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
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

    // Try to spend from the sanctioned address:
    wrapped.connect(owner.signer).approve(tmpAccount.address, 100);
    await expect(
      token
        .connect(tmpAccount.signer)
        .transferFrom(owner.address, minter.address, 50)
    ).to.be.revertedWith("BackedToken: spender is sanctioned");

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

  it("SanctionsList stops minting and burning", async function () {
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
    await expect(wrapped.connect(burner.signer).redeem(50, burner.address, burner.address)).to.be.revertedWith('BackedToken: sender is sanctioned');
  });

  it("SanctionsList stops minting and burning", async function () {
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


});
function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}

