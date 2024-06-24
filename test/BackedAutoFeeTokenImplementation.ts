import { ProxyAdmin__factory } from '../typechain/factories/ProxyAdmin__factory';
import { ProxyAdmin } from '../typechain/ProxyAdmin';
import { BackedAutoFeeTokenImplementation__factory } from '../typechain/factories/BackedAutoFeeTokenImplementation__factory';
import { BackedAutoFeeTokenImplementation } from '../typechain/BackedAutoFeeTokenImplementation';
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  BackedTokenProxy__factory,
  SanctionsListMock,
  SanctionsListMock__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { cacheBeforeEach } from "./helpers";
import Decimal from 'decimal.js';

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

// BackedAutoFeeTokenImplementation specifications
// Vast majority of comparisons are done with adjustment for precision of calculations, thus we are rather comparing difference of values,
// rather than values themselves
describe("BackedAutoFeeTokenImplementation", function () {
  const accrualPeriodLength = 24 * 3600;
  const annualFee = 0.5;
  const multiplierAdjustmentPerPeriod = nthRoot(annualFee, 365).mul(Decimal.pow(10, 18));
  const baseFeePerPeriod = Decimal.pow(10, 18).minus(multiplierAdjustmentPerPeriod).toFixed(0);
  const baseTime = 2_000_000_000;
  const tokenName = "Backed Apple";
  const tokenSymbol = "bAAPL";

  // General config:
  let token: BackedAutoFeeTokenImplementation;
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
    const tokenImplementation = await tokenImplementationFactory.deploy();
    const proxyAdminFactory = new ProxyAdmin__factory(owner.signer)
    proxyAdmin = await proxyAdminFactory.deploy();
    const tokenProxy = await new BackedTokenProxy__factory(owner.signer).deploy(tokenImplementation.address, proxyAdmin.address, tokenImplementation.interface.encodeFunctionData(
      'initialize(string,string,uint256,uint256)',
      [
        tokenName,
        tokenSymbol,
        24 * 3600,
        baseTime
      ]
    ));
    token = BackedAutoFeeTokenImplementation__factory.connect(tokenProxy.address, owner.signer);
    await token.setMinter(owner.address);
    await token.setBurner(owner.address);
    await token.setPauser(owner.address);
    await token.setMultiplierUpdater(owner.address);
    sanctionsList = await new SanctionsListMock__factory(blacklister.signer).deploy();
    await token.setSanctionsList(sanctionsList.address);
    await token.updateFeePerPeriod(baseFeePerPeriod);

    // Chain Id
    const network = await ethers.provider.getNetwork();
    chainId = BigNumber.from(network.chainId);
  });


  describe('#getCurrentMultiplier', () => {
    describe('when time moved by 365 days forward', () => {
      const periodsPassed = 365;
      let preMultiplier: BigNumber;
      describe('and fee is set to non-zero value', () => {
        cacheBeforeEach(async () => {
          preMultiplier = await token.multiplier();
          await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
          await helpers.mine()
        })

        it('should change current multiplier', async () => {
          expect((await token.getCurrentMultiplier()).newMultiplier).to.be.not.equal(preMultiplier)
        })
        it('should not update stored multiplier', async () => {
          expect(await token.multiplier()).to.be.equal(preMultiplier)
        })
      })
      describe('and fee is set to zero', () => {
        cacheBeforeEach(async () => {
          await token.updateFeePerPeriod('0');
          preMultiplier = await token.multiplier();
          await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
          await helpers.mine()
        })

        it('should not change current multiplier', async () => {
          expect((await token.getCurrentMultiplier()).newMultiplier).to.be.equal(preMultiplier)
        })
      })
    })
  })

  describe('#setMultiplierUpdater', () => {
    describe('When called by non owner', () => {
      const subject = () => token.connect(actor.signer).setMultiplierUpdater(actor.address)
      it('should revert transaction', async () => {
        await expect(subject()).to.be.reverted
      })
    })
    describe('When called by owner', () => {
      const subject = () => token.setMultiplierUpdater(actor.address)
      it('should update multiplier updater', async () => {
        await subject()
        expect(await token.multiplierUpdater()).to.be.equal(actor.address)
      })
    })
  })
  describe('#setLastTimeFeeApplied', () => {
    describe('When called by non owner', () => {
      const subject = () => token.connect(actor.signer).setLastTimeFeeApplied(1)
      it('should revert transaction', async () => {
        await expect(subject()).to.be.reverted
      })
    })
    describe('When called by owner', () => {
      const subject = () => token.setLastTimeFeeApplied(1)
      it('should update last time fee applied', async () => {
        await subject()
        expect(await token.lastTimeFeeApplied()).to.be.equal(1)
      })
    })
  })
  describe('#setPeriodLength', () => {
    describe('When called by non owner', () => {
      const subject = () => token.connect(actor.signer).setPeriodLength(1)
      it('should revert transaction', async () => {
        await expect(subject()).to.be.reverted
      })
    })
    describe('When called by owner', () => {
      const subject = () => token.setPeriodLength(1)
      it('should update period length', async () => {
        await subject()
        expect(await token.periodLength()).to.be.equal(1)
      })
    })
  })
  describe('#updateFeePerPeriod', () => {
    describe('When called by non owner', () => {
      const subject = () => token.connect(actor.signer).updateFeePerPeriod(1)
      it('should revert transaction', async () => {
        await expect(subject()).to.be.reverted
      })
    })
    describe('When called by owner', () => {
      const subject = () => token.updateFeePerPeriod(1)
      it('should update fee per period', async () => {
        await subject()
        expect(await token.feePerPeriod()).to.be.equal(1)
      })
    })
  })
  describe('#updateMultiplier', () => {
    describe('when time moved by 365 days forward', () => {
      const periodsPassed = 365;
      const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
      let mintedShares: BigNumber;
      cacheBeforeEach(async () => {
        await token.mint(owner.address, baseMintedAmount);
        mintedShares = await token.sharesOf(owner.address);
        await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
        await helpers.mine()
      })

      describe('#updateMultiplierValue', () => {
        it('Should update stored multiplier value', async () => {
          const { newMultiplier: currentMultiplier } = await token.getCurrentMultiplier();
          const newMultiplierValue = currentMultiplier.div(2);
          await token.updateMultiplierValue(newMultiplierValue, currentMultiplier)
          expect(await token.multiplier()).to.be.equal(newMultiplierValue);
          expect(await token.lastTimeFeeApplied()).to.be.equal(baseTime + periodsPassed * accrualPeriodLength);
        });
        it('Should reject update, if wrong past value was passed', async () => {
          await expect(token.updateMultiplierValue(0, 1)).to.be.reverted;
        });
        it('Should reject update, if wrong account is used', async () => {
          const { newMultiplier: currentMultiplier } = await token.getCurrentMultiplier();
          await expect(token.connect(actor.signer).updateMultiplierValue(1, currentMultiplier)).to.be.reverted
        });
      });

      describe('#balanceOf', () => {
        it('Should decrease balance of the user by fee accrued in 365 days', async () => {
          expect((await token.balanceOf(owner.address)).sub(baseMintedAmount.mul(annualFee * 100).div(100)).abs()).to.lte(
            BigNumber.from(10).pow(3)
          )
        })
      });

      describe('#totalSupply', () => {
        it('Should decrease total supply of the token by the fee accrued in 365 days', async () => {
          expect((await token.totalSupply()).sub(baseMintedAmount.mul(annualFee * 100).div(100)).abs()).to.lte(
            BigNumber.from(10).pow(3)
          )
        })
      });

      describe('#transfer', () => {
        it('Should not allow transfer of previous balance of user', async () => {
          await expect(token.transfer(actor.address, baseMintedAmount)).to.be.reverted;
        })
        it('Should allow transfer of current balance of user', async () => {
          await expect(token.transfer(actor.address, (await token.balanceOf(actor.address)))).to.not.be.reverted;
        })
      });
      describe('#transferShares', () => {
        it('Should allow transfer of shares of user', async () => {
          await expect(token.transfer(actor.address, mintedShares)).to.be.reverted;
        })
      });
      describe('#mint', () => {
        const newlyMintedTokens = ethers.BigNumber.from(10).pow(18)
        cacheBeforeEach(async () => {
          await token.mint(actor.address, newlyMintedTokens);
        })
        it('Should mint requested number of tokens', async () => {
          expect((await token.balanceOf(actor.address)).sub(newlyMintedTokens).abs()).to.be.lte(1);
        })
        it('Should mint number of shares according to multiplier', async () => {
          expect(await token.sharesOf(actor.address)).to.be.eq(newlyMintedTokens.mul(ethers.BigNumber.from(10).pow(18)).div((await token.getCurrentMultiplier()).newMultiplier));
        })
      });
    })
  })
  describe('#transferShares', () => {
    const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
    cacheBeforeEach(async () => {
      await token.mint(owner.address, baseMintedAmount);
    })
    describe('When transfering shares to another account', () => {
      const sharesToTransfer = ethers.BigNumber.from(10).pow(18);
      const subject = () => token.transferShares(actor.address, sharesToTransfer)
      let userBalance: BigNumber;
      cacheBeforeEach(async () => {
        userBalance = await token.getUnderlyingAmountByShares(sharesToTransfer);
      })
      it('Should move requested shares of tokens', async () => {
        await subject();
        expect((await token.sharesOf(actor.address))).to.be.eq(sharesToTransfer);
      })
      it('Should increase balance of destination wallet', async () => {
        await subject();
        expect((await token.balanceOf(actor.address))).to.be.eq(userBalance);
      })
    })
  });
  describe('#delegatedTransferShares', () => {
    const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
    cacheBeforeEach(async () => {
      await token.mint(owner.address, baseMintedAmount);
    })
    describe('When transfering shares from another account', () => {
      const sharesToTransfer = ethers.BigNumber.from(10).pow(18);
      let signature: string;
      let deadline: number;
      let nonce: BigNumber;
      const subject = async () => {
        const sig = ethers.utils.splitSignature(signature)
        return token.connect(actor.signer).delegatedTransferShares(owner.address, actor.address, sharesToTransfer, deadline, sig.v, sig.r, sig.s);
      }
      let userBalance: BigNumber;
      cacheBeforeEach(async () => {
        userBalance = await token.getUnderlyingAmountByShares(sharesToTransfer);

        deadline = baseTime * 2;
        nonce = await token.nonces(owner.address);
        const domain = {
          name: await token.name(),
          version: "1",
          chainId: await owner.signer.getChainId(),
          verifyingContract: token.address
        };
        const types = {
          DELEGATED_TRANSFER_SHARES: [
            {
              type: 'address',
              name: 'owner'
            },
            {
              type: 'address',
              name: 'to'
            },
            {
              type: 'uint256',
              name: 'value'
            },
            {
              type: 'uint256',
              name: 'nonce'
            },
            {
              type: 'uint256',
              name: 'deadline'
            }
          ]
        };
        const msg = {
          owner: owner.address,
          to: actor.address,
          value: sharesToTransfer,
          nonce: nonce,
          deadline: deadline
        };

        const signer = await ethers.getSigner(owner.address);
        signature = await signer._signTypedData(domain, types, msg);
      })
      describe('And caller is whitelisted delegate', () => {
        cacheBeforeEach(async () => {
          await token.setDelegateWhitelist(actor.address, true);
        })
        it('Should move requested shares of tokens', async () => {
          await subject();
          expect((await token.sharesOf(actor.address))).to.be.eq(sharesToTransfer);
        })
        it('Should increase balance of destination wallet', async () => {
          await subject();
          expect((await token.balanceOf(actor.address))).to.be.eq(userBalance);
        })
        it('Should revert if deadline already passed', async () => {
          await helpers.time.setNextBlockTimestamp(deadline + 1);
          await helpers.mine()
          await expect(subject()).to.be.reverted;
        })
      })
      describe('And caller is whitelisted delegate', () => {

        it('Should revert', async () => {
          await expect(subject()).to.be.reverted;
        })
      })
    })
  });

  // Tests copied from base BackedTokenImplementation tests:

  it("Cannot initialize twice", async function () {
    await expect(
      token.connect(owner.signer)['initialize(string,string)']("test1", "test2")
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("Basic information check", async function () {
    expect(await token.name()).to.equal(tokenName);
    expect(await token.symbol()).to.equal(tokenSymbol);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.terms()).to.equal(
      "https://www.backedassets.fi/legal-documentation"
    );
    expect(await token.VERSION()).to.equal("1.1.0");
  });

  it("Define Minter and transfer Minter", async function () {
    // Set Minter
    let receipt = await (await token.setMinter(minter.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewMinter");
    expect(receipt.events?.[0].args?.[0]).to.equal(minter.address);
    expect(await token.minter()).to.equal(minter.address);

    // Change Minter
    receipt = await (await token.setMinter(tmpAccount.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewMinter");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
  });

  it("Try to define Minter from wrong address", async function () {
    await expect(
      token.connect(accounts[3]).setMinter(minter.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Mint", async function () {
    await token.setMinter(minter.address);
    const receipt = await (
      await token.connect(minter.signer).mint(tmpAccount.address, 100)
    ).wait();

    expect(receipt.events?.[0].event).to.equal("Transfer");
    expect(receipt.events?.[0].args?.[0]).to.equal(
      ethers.constants.AddressZero
    );
    expect(receipt.events?.[0].args?.[1]).to.equal(tmpAccount.address);
    expect(receipt.events?.[0].args?.[2]).to.equal(100);
    expect(await token.balanceOf(tmpAccount.address)).to.equal(100);
  });

  it("Try to mint from unauthorized account", async function () {
    await token.setMinter(minter.address);
    await expect(token.mint(tmpAccount.address, 100)).to.revertedWith(
      "BackedToken: Only minter"
    );
  });

  it("Define Burner and transfer Burner", async function () {
    // Set Burner
    let receipt = await (await token.setBurner(burner.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewBurner");
    expect(receipt.events?.[0].args?.[0]).to.equal(burner.address);
    expect(await token.burner()).to.equal(burner.address);

    // Change Burner
    receipt = await (await token.setBurner(tmpAccount.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewBurner");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
  });

  it("Try to define Burner from wrong address", async function () {
    await expect(
      token.connect(accounts[3]).setBurner(burner.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Burn", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(burner.address, 100);
    await token.setBurner(burner.address);
    const receipt = await (
      await token.connect(burner.signer).burn(burner.address, 10)
    ).wait();

    expect(receipt.events?.[0].event).to.equal("Transfer");
    expect(receipt.events?.[0].args?.[0]).to.equal(burner.address);
    expect(receipt.events?.[0].args?.[1]).to.equal(
      ethers.constants.AddressZero
    );
    expect(receipt.events?.[0].args?.[2]).to.equal(10);
    expect(await token.balanceOf(burner.address)).to.equal(90);
  });

  it("Burn from the token contract balance", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(token.address, 100);
    await token.setBurner(burner.address);
    const receipt = await (
      await token.connect(burner.signer).burn(token.address, 10)
    ).wait();

    expect(receipt.events?.[0].event).to.equal("Transfer");
    expect(receipt.events?.[0].args?.[0]).to.equal(token.address);
    expect(receipt.events?.[0].args?.[1]).to.equal(
      ethers.constants.AddressZero
    );
    expect(receipt.events?.[0].args?.[2]).to.equal(10);
    expect(await token.balanceOf(token.address)).to.equal(90);
  });

  it("Try to burn funds of another account", async function () {
    await token.setMinter(minter.address);
    await token.setBurner(burner.address);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await expect(
      token.connect(burner.signer).burn(tmpAccount.address, 10)
    ).to.revertedWith("BackedToken: Cannot burn account");
  });

  it("Try to burn from unauthorized account", async function () {
    await token.setMinter(minter.address);
    await token.setBurner(burner.address);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await expect(token.burn(tmpAccount.address, 100)).to.revertedWith(
      "BackedToken: Only burner"
    );
  });

  it("Define Pauser and transfer Pauser", async function () {
    // Set Pauser
    let receipt = await (await token.setPauser(pauser.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewPauser");
    expect(receipt.events?.[0].args?.[0]).to.equal(pauser.address);
    expect(await token.pauser()).to.equal(pauser.address);

    // Change Pauser
    receipt = await (await token.setPauser(tmpAccount.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewPauser");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(await token.pauser()).to.equal(tmpAccount.address);
  });

  it("Try to define Pauser from wrong address", async function () {
    await expect(
      token.connect(accounts[3]).setPauser(pauser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Pause and Unpause", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(owner.address, 100);
    await token.setPauser(pauser.address);

    await expect(token.connect(accounts[2]).setPause(true)).to.be.revertedWith(
      "BackedToken: Only pauser"
    );

    const receipt = await (
      await token.connect(pauser.signer).setPause(true)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt.events?.[0].args?.[0]).to.equal(true);

    await expect(token.transfer(tmpAccount.address, 100)).to.be.revertedWith(
      "BackedToken: token transfer while paused"
    );

    // Unpause:
    const receipt2 = await (
      await token.connect(pauser.signer).setPause(false)
    ).wait();
    expect(receipt2.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt2.events?.[0].args?.[0]).to.equal(false);

    await token.transfer(tmpAccount.address, 100);
    expect(await token.balanceOf(tmpAccount.address)).to.equal(100);
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
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes(tokenName)),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1")),
          chainId,
          token.address,
        ]
      )
    );
    // ToDo:
    expect(await token.DOMAIN_SEPARATOR()).to.equal(domainSeparator);
  });

  it("EIP-712 TypeHashes", async function () {
    // Check Permit TypeHash:
    const permitTypehash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
      )
    );
    expect(await token.PERMIT_TYPEHASH()).to.equal(permitTypehash);

    // Check Permit TypeHash:
    const delegatedTransferTypehash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(
        "DELEGATED_TRANSFER(address owner,address to,uint256 value,uint256 nonce,uint256 deadline)"
      )
    );
    expect(await token.DELEGATED_TRANSFER_TYPEHASH()).to.equal(
      delegatedTransferTypehash
    );
  });

  it("Permit EIP-712 test", async function () {
    const domain = {
      name: tokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: token.address,
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
      token.permit(
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
    await token.setDelegateWhitelist(owner.address, true);

    await expect(
      token.permit(
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

    const tx = await token.permit(
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
    expect(await token.allowance(tmpAccount.address, minter.address)).to.equal(
      100
    );

    // Set delegation mode to true and try again:
    await token.setDelegateMode(true);
    msg.nonce = 1;
    msg.value = 150;
    const sig2 = await signer._signTypedData(domain, types, msg);
    const splitSig2 = ethers.utils.splitSignature(sig2);

    const tx2 = await token
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
    expect(await token.allowance(tmpAccount.address, minter.address)).to.equal(
      150
    );

    // Replay msg should fail:
    await expect(
      token
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
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(tmpAccount.address, 500);

    const domain = {
      name: tokenName,
      version: "1",
      chainId: chainId,
      verifyingContract: token.address,
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
      token.delegatedTransfer(
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
    await token.setDelegateWhitelist(owner.address, true);

    await expect(
      token.delegatedTransfer(
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

    const tx = await token.delegatedTransfer(
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
    expect(await token.balanceOf(tmpAccount.address)).to.equal(400);
    expect(await token.balanceOf(minter.address)).to.equal(100);

    // Set delegation mode to true and try again:
    await token.setDelegateMode(true);
    msg.nonce = 1;
    msg.value = 200;
    const sig2 = await signer._signTypedData(domain, types, msg);
    const splitSig2 = ethers.utils.splitSignature(sig2);

    const tx2 = await token
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
    expect(await token.balanceOf(tmpAccount.address)).to.equal(200);
    expect(await token.balanceOf(minter.address)).to.equal(300);

    // Replay msg should fail:
    await expect(
      token
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
      token.connect(tmpAccount.signer).setDelegateMode(true)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Delegate address:
    await expect(
      token
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
    expect(await token.sanctionsList()).to.equal(sanctionsList.address);

    // Change SanctionsList
    const receipt = await (
      await token.setSanctionsList(sanctionsList2.address)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("NewSanctionsList");
    expect(receipt.events?.[0].args?.[0]).to.equal(sanctionsList2.address);
    expect(await token.sanctionsList()).to.equal(sanctionsList2.address);
  });

  it("Try to set SanctionsList from wrong address", async function () {
    await expect(
      token.connect(tmpAccount.signer).setSanctionsList(tmpAccount.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Try to set SanctionsList to a contract not following the interface", async function () {
    await expect(
      token.connect(owner.signer).setSanctionsList(token.address)
    ).to.be.revertedWith(
      "Transaction reverted: function selector was not recognized and there's no fallback function"
    );
  });

  it("Check blocking of address in the Sanctions List", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(owner.address, 100);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await token.setPauser(pauser.address);

    // Add an address to the sanctions list:
    await (
      await sanctionsList
        .connect(blacklister.signer)
        .addToSanctionsList([tmpAccount.address])
    ).wait();

    // Try to send to the sanctioned address:
    await expect(token.transfer(tmpAccount.address, 100)).to.be.revertedWith(
      "BackedToken: receiver is sanctioned"
    );

    // Try to send from the sanctioned address:
    await expect(
      token.connect(tmpAccount.signer).transfer(owner.address, 100)
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

    // Try to spend from the sanctioned address:
    token.connect(owner.signer).approve(tmpAccount.address, 100);
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
    await token.transfer(tmpAccount.address, 100);
    await token.connect(tmpAccount.signer).transfer(owner.address, 100);

    // Check transferFrom is possible:
    await token
      .connect(tmpAccount.signer)
      .transferFrom(owner.address, burner.address, 50);
    expect(await token.balanceOf(burner.address)).to.equal(50);
    expect(await token.balanceOf(owner.address)).to.equal(50);
  });

  it("SanctionsList cannot stop minting and burning", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(owner.address, 100);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await token.setBurner(burner.address);
    await token.setPauser(pauser.address);
    await token.setSanctionsList(sanctionsList.address);

    // Sanction 0x0 address, and still mint:
    await sanctionsList.addToSanctionsList([ethers.constants.AddressZero]);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    expect(await token.balanceOf(tmpAccount.address)).to.equal(200);

    // Try to sanction minter address:
    await sanctionsList
      .connect(blacklister.signer)
      .addToSanctionsList([minter.address]);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    expect(await token.balanceOf(tmpAccount.address)).to.equal(300);

    // Try to sanction burner address:
    await token.connect(minter.signer).mint(burner.address, 100);
    await sanctionsList
      .connect(blacklister.signer)
      .addToSanctionsList([burner.address]);
    await token.connect(burner.signer).burn(burner.address, 50);
    expect(await token.balanceOf(burner.address)).to.equal(50);
  });

  it("Check and set Terms", async function () {
    // Test current Terms:
    expect(await token.terms()).to.equal(
      "https://www.backedassets.fi/legal-documentation"
    );

    // Change Terms
    const receipt = await (await token.setTerms("New Terms ^^")).wait();
    expect(receipt.events?.[0].event).to.equal("NewTerms");
    expect(receipt.events?.[0].args?.[0]).to.equal("New Terms ^^");
    expect(await token.terms()).to.equal("New Terms ^^");
  });

  it("Try to set Terms from wrong address", async function () {
    await expect(
      token.connect(tmpAccount.signer).setTerms("Random Terms")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });


});
function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}

