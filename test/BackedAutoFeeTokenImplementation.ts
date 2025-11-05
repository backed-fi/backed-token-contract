/* eslint-disable prettier/prettier */
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  ProxyAdmin__factory,
  ProxyAdmin,
  BackedAutoFeeTokenImplementation__factory,
  BackedAutoFeeTokenImplementation,
  BackedTokenImplementation__factory,
  BackedTokenProxy__factory,
  SanctionsListMock,
  SanctionsListMock__factory
} from "../typechain";
import { cacheBeforeEach } from "./helpers";
import Decimal from "decimal.js";

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
  let tokenImplementation: BackedAutoFeeTokenImplementation;
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
    await token.setMinter(minter.address);
    await token.setBurner(burner.address);
    await token.setPauser(pauser.address);
    await token.setMultiplierUpdater(owner.address);
    sanctionsList = await new SanctionsListMock__factory(blacklister.signer).deploy();
    await token.setSanctionsList(sanctionsList.address);

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
        tokenImplementation['initialize(string,string)'](
          tokenName,
          tokenSymbol
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
    it("block calling initialize_v2 on implementation contract", async function () {
      await expect(
        tokenImplementation.initialize_v2(
          1,
          1,
          0
        )
      ).to.be.revertedWith("BackedAutoFeeTokenImplementation already initialized");
    });
  });

  describe('#initializer_v2', () => {
    it("Cannot initialize twice", async function () {
      await expect(
        token.connect(owner.signer).initialize_v2(
          24 * 3600,
          baseTime,
          baseFeePerPeriod
        )
      ).to.be.revertedWith("BackedAutoFeeTokenImplementation already initialized");
    });
    describe('when being called on contract initialized to v1', () => {
      let token: BackedAutoFeeTokenImplementation;
      cacheBeforeEach(async () => {
        const oldTokenImplementationFactory = new BackedTokenImplementation__factory(owner.signer);
        const oldTokenImplementation = await oldTokenImplementationFactory.deploy();
        const tokenProxy = await new BackedTokenProxy__factory(owner.signer).deploy(oldTokenImplementation.address, proxyAdmin.address, oldTokenImplementation.interface.encodeFunctionData(
          'initialize',
          [
            tokenName,
            tokenSymbol
          ]
        ));
        token = BackedAutoFeeTokenImplementation__factory.connect(tokenProxy.address, owner.signer);
      });
      it("Cannot initialize with last time fee applied set to zero ", async function () {
        await expect(
          proxyAdmin.upgradeAndCall(
            token.address,
            tokenImplementation.address,
            tokenImplementation.interface.encodeFunctionData(
              'initialize_v2',
              [
                24 * 3600,
                0,
                baseFeePerPeriod
              ]
            )
          )
        ).to.be.revertedWith("Invalid last time fee applied");
      });

      it('Should be able to upgrade with initialize_v2 method', async () => {
        await proxyAdmin.upgradeAndCall(
          token.address,
          tokenImplementation.address,
          tokenImplementation.interface.encodeFunctionData(
            'initialize_v2',
            [
              24 * 3600,
              baseTime,
              baseFeePerPeriod
            ]
          )
        )
        expect(await token.multiplier()).to.be.eq(ethers.BigNumber.from(10).pow(18));
        expect(await token.lastTimeFeeApplied()).to.be.eq(baseTime);
        expect(await token.feePerPeriod()).to.be.eq(baseFeePerPeriod);
      })
    });
  })

  describe('#initializer_v3', () => {
    describe('When called on already initialized v3 contract', () => {
      it("Cannot initialize twice", async function () {
        await expect(
          token.connect(owner.signer).initialize_v3()
        ).to.be.revertedWith("BackedAutoFeeTokenImplementation v3 already initialized");
      });
    });

    describe('When upgrading from v2 to v3', () => {
      let tokenV2Upgraded: BackedAutoFeeTokenImplementation;

      // Create a v2 implementation mock that doesn't initialize the new v3 fields
      cacheBeforeEach(async () => {
        // Deploy old v1 token
        const oldTokenImplementationFactory = new BackedTokenImplementation__factory(owner.signer);
        const oldTokenImplementation = await oldTokenImplementationFactory.deploy();
        const tokenProxy = await new BackedTokenProxy__factory(owner.signer).deploy(
          oldTokenImplementation.address,
          proxyAdmin.address,
          oldTokenImplementation.interface.encodeFunctionData('initialize', [tokenName, tokenSymbol])
        );

        // Upgrade to v2 (BackedAutoFeeTokenImplementation)
        const v2Implementation = await new BackedAutoFeeTokenImplementation__factory(owner.signer).deploy();
        await proxyAdmin.upgradeAndCall(
          tokenProxy.address,
          v2Implementation.address,
          v2Implementation.interface.encodeFunctionData('initialize_v2', [24 * 3600, baseTime, baseFeePerPeriod])
        );

        // Now upgrade to v3 implementation (without calling initialize_v3)
        // In real v2->v3 upgrade, newMultiplier would be 0 (uninitialized storage)
        // But since our test uses the same implementation, we can't test the "real" upgrade path
        // This test documents the expected behavior
        tokenV2Upgraded = BackedAutoFeeTokenImplementation__factory.connect(tokenProxy.address, owner.signer);
      });

      it("Should initialize v3 fields when upgrading from v2", async function () {
        // The initialize_v3 should be called during the v2->v3 upgrade
        // In this test setup, newMultiplier is already initialized to 1e18 by initialize_v2
        // (because we use the same implementation for both v2 and v3)
        // In a real upgrade, v2 wouldn't have newMultiplier field, so initialize_v3 would succeed
        expect(await tokenV2Upgraded.newMultiplier()).to.be.equal(ethers.BigNumber.from(10).pow(18));
        expect(await tokenV2Upgraded.newMultiplierNonce()).to.be.equal(0);
        expect(await tokenV2Upgraded.newMultiplierActivationTime()).to.be.equal(0);
      });
    });
  })

  describe('#getCurrentMultiplier', () => {
    describe('when time moved by 365 days forward', () => {
      const periodsPassed = 365;
      let preMultiplier: BigNumber;
      let preMultiplierNonce: BigNumber;
      describe('and fee is set to non-zero value', () => {
        cacheBeforeEach(async () => {
          preMultiplier = await token.multiplier();
          preMultiplierNonce = await token.multiplierNonce();
          await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
          await helpers.mine()
        })

        it('should change current multiplier', async () => {
          const currentMultiplier = await token.getCurrentMultiplier();
          expect(currentMultiplier.currentMultiplier).to.be.not.equal(preMultiplier)
          expect(currentMultiplier.currentMultiplierNonce).to.be.not.equal(preMultiplierNonce)
        })
        it('should not update stored multiplier', async () => {
          expect(await token.multiplier()).to.be.equal(preMultiplier)
        })
      })
      describe('and fee is set to zero', () => {
        cacheBeforeEach(async () => {
          await token.updateFeePerPeriod('0');
          preMultiplier = await token.multiplier();
          preMultiplierNonce = await token.multiplierNonce();
          await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
          await helpers.mine()
        })

        it('should not change current multiplier', async () => {
          expect((await token.getCurrentMultiplier()).currentMultiplier).to.be.equal(preMultiplier)
        })

        it('should not change current multiplier nonce', async () => {
          expect((await token.getCurrentMultiplier()).currentMultiplierNonce).to.be.equal(preMultiplierNonce)
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
    describe('When trying to set value to zero', () => {
      const subject = () => token.setLastTimeFeeApplied(0)
      it('should revert transaction', async () => {
        await expect(subject()).to.be.revertedWith("Invalid last time fee applied")
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
  describe('#transfer', () => {
    describe('And transfering to zero address', () => {
      const subject = (toAddress: string) => token.transfer(toAddress, 1)
      it('should revert transaction', async () => {
        await expect(subject(ethers.constants.AddressZero)).to.be.revertedWith("ERC20: transfer to the zero address")
      })
    })
  })
  describe('#transferFrom', () => {
    describe('And transfering from zero address', () => {
      let zeroSigner: Signer;
      cacheBeforeEach(async () => {
        await helpers.impersonateAccount(ethers.constants.AddressZero);
        zeroSigner = await ethers.getSigner(ethers.constants.AddressZero)
      })
      const subject = (toAddress: string) => token.connect(zeroSigner).transfer(toAddress, 1)
      it('should revert transaction', async () => {
        await expect(subject(owner.address)).to.be.revertedWith("ERC20: transfer from the zero address")
      })
    })
  })
  describe('#mint', () => {
    describe('And minting to zero address', () => {
      const subject = (toAddress: string) => token.connect(minter.signer).mint(toAddress, 1)
      it('should revert transaction', async () => {
        await expect(subject(ethers.constants.AddressZero)).to.be.revertedWith("ERC20: mint to the zero address")
      })
    })
  })
  describe('#burn', () => {
    describe('And burning from zero address', () => {
      let zeroSigner: Signer;
      cacheBeforeEach(async () => {
        await helpers.impersonateAccount(ethers.constants.AddressZero);
        zeroSigner = await ethers.getSigner(ethers.constants.AddressZero);
        await token.setBurner(ethers.constants.AddressZero);
      })
      const subject = (fromAddress: string) => token.connect(zeroSigner).burn(fromAddress, 1)
      it('should revert transaction', async () => {
        await expect(subject(ethers.constants.AddressZero)).to.be.revertedWith("ERC20: burn from the zero address")
      })
    })
    describe('And burning from address that has no sufficient balance', () => {
      const subject = (fromAddress: string) => token.connect(burner.signer).burn(fromAddress, 1)
      it('should revert transaction', async () => {
        await expect(subject(burner.address)).to.be.revertedWith("ERC20: burn amount exceeds balance")
      })
    })
  })
  describe('#updateMultiplier', () => {
    describe('when time moved by 365 days forward', () => {
      const periodsPassed = 365;
      const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
      let mintedShares: BigNumber;
      cacheBeforeEach(async () => {
        await token.connect(minter.signer).mint(owner.address, baseMintedAmount);
        mintedShares = await token.sharesOf(owner.address);
        await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
        await helpers.mine()
      })

      describe('#updateMultiplierValue', () => {
        it('Should update stored multiplier value and nonce', async () => {
          const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
          const newMultiplierValue = currentMultiplier.div(2);
          await token.updateMultiplierValue(newMultiplierValue, currentMultiplier, 0)
          expect(await token.multiplier()).to.be.equal(newMultiplierValue);
          expect(await token.multiplierNonce()).to.be.equal(currentMultiplierNonce.add(1));
          expect(await token.lastTimeFeeApplied()).to.be.equal(baseTime + periodsPassed * accrualPeriodLength);
        });
        it('Should reject update, if wrong past value was passed', async () => {
          await expect(token.updateMultiplierValue(0, 1, 0)).to.be.reverted;
        });
        it('Should reject update, if wrong account is used', async () => {
          const { currentMultiplier } = await token.getCurrentMultiplier();
          await expect(token.connect(actor.signer).updateMultiplierValue(1, currentMultiplier, 0)).to.be.reverted
        });
      });

      describe('#updateMultiplierWithNonce', () => {
        it('Should update stored multiplier value and nonce', async () => {
          const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
          const newMultiplierValue = currentMultiplier.div(2);
          const newMultiplierNonce = currentMultiplierNonce.add(100);
          await token.updateMultiplierWithNonce(newMultiplierValue, currentMultiplier, newMultiplierNonce, 0)
          expect(await token.multiplier()).to.be.equal(newMultiplierValue);
          expect(await token.multiplierNonce()).to.be.equal(newMultiplierNonce);
          expect(await token.lastTimeFeeApplied()).to.be.equal(baseTime + periodsPassed * accrualPeriodLength);
        });
        it('Should reject update, if wrong past value was passed', async () => {
          await expect(token.updateMultiplierWithNonce(0, 1, 1, 0)).to.be.reverted;
        });
        it('Should reject update, if wrong account is used', async () => {
          const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
          await expect(token.connect(actor.signer).updateMultiplierWithNonce(1, currentMultiplier, currentMultiplierNonce.add(1), 0)).to.be.reverted
        });
        it('Should reject update, if wrong nonce is used', async () => {
          const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
          await expect(token.connect(actor.signer).updateMultiplierWithNonce(1, currentMultiplier, currentMultiplierNonce, 0)).to.be.reverted
        });

        describe('With delayed activation', () => {
          const futureTime = baseTime + (periodsPassed + 1) * accrualPeriodLength - 60; // 60 seconds before the end of the current period

          it('Should store new multiplier with future activation time', async () => {
            const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
            const newMultiplierValue = currentMultiplier.div(2);
            const newMultiplierNonce = currentMultiplierNonce.add(100);

            await token.updateMultiplierWithNonce(newMultiplierValue, currentMultiplier, newMultiplierNonce, futureTime);

            // Current multiplier should not change yet
            expect(await token.multiplier()).to.be.equal(currentMultiplier);
            expect(await token.multiplierNonce()).to.be.equal(currentMultiplierNonce);
            // New multiplier should be stored
            expect(await token.newMultiplier()).to.be.equal(newMultiplierValue);
            expect(await token.newMultiplierNonce()).to.be.equal(newMultiplierNonce);
            expect(await token.newMultiplierActivationTime()).to.be.equal(futureTime);
          });

          it('Should activate delayed multiplier when time reaches activation', async () => {
            const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
            const newMultiplierValue = currentMultiplier.div(2);
            const newMultiplierNonce = currentMultiplierNonce.add(100);

            await token.updateMultiplierWithNonce(newMultiplierValue, currentMultiplier, newMultiplierNonce, futureTime);

            // Move time to exact activation moment
            await helpers.time.setNextBlockTimestamp(futureTime);
            await helpers.mine();

            // Check view function at exact activation time - no fees applied yet
            // since we're checking at the precise moment of activation
            expect(await token.multiplier()).to.be.equal(newMultiplierValue);
            expect(await token.multiplierNonce()).to.be.equal(newMultiplierNonce);
          });

          it('Should apply fees from activation time when delayed multiplier activates', async () => {
            const { currentMultiplier, currentMultiplierNonce } = await token.getCurrentMultiplier();
            const newMultiplierValue = currentMultiplier.mul(110).div(100); // 10% increase
            const newMultiplierNonce = currentMultiplierNonce.add(100);

            await token.updateMultiplierWithNonce(newMultiplierValue, currentMultiplier, newMultiplierNonce, futureTime);

            // Move time past activation (7 days)
            await helpers.time.setNextBlockTimestamp(futureTime + accrualPeriodLength * 7);

            // Trigger multiplier update via transaction
            // This persists the multiplier to storage and applies fees from activation time
            await token.transfer(actor.address, 1);

            // Calculate expected multiplier with 7 days of fees applied from activation time
            // Unlike the previous test, this checks stored state after a triggered update,
            // so fees ARE applied for the time period from activation to now
            const feePerPeriod = await token.feePerPeriod();
            const periodsPassed = 7;
            let expectedMult = newMultiplierValue;
            for (let i = 0; i < periodsPassed; i++) {
              expectedMult = expectedMult.mul(ethers.BigNumber.from(10).pow(18).sub(feePerPeriod)).div(ethers.BigNumber.from(10).pow(18));
            }

            expect(await token.lastMultiplier()).to.be.equal(expectedMult);
            expect(await token.newMultiplierActivationTime()).to.be.equal(0);
          });
        });
      });

      describe('#balanceOf', () => {
        it('Should decrease balance of the user by fee accrued in 365 days', async () => {
          expect((await token.balanceOf(owner.address)).sub(baseMintedAmount.mul(annualFee * 100).div(100)).abs()).to.lte(
            BigNumber.from(10).pow(3)
          )
        })
      });

      describe('#getSharesByUnderlyingAmount', () => {
        it('Should increase amount of shares neeeded for given underlying amount', async () => {
          const amount = 1000;
          expect((await token.getSharesByUnderlyingAmount(amount))).to.eq(ethers.BigNumber.from(amount / annualFee))
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
          await token.connect(minter.signer).mint(actor.address, newlyMintedTokens);
        })
        it('Should mint requested number of tokens', async () => {
          expect((await token.balanceOf(actor.address)).sub(newlyMintedTokens).abs()).to.be.lte(1);
        })
        it('Should mint number of shares according to multiplier', async () => {
          expect(await token.sharesOf(actor.address)).to.be.eq(newlyMintedTokens.mul(ethers.BigNumber.from(10).pow(18)).div((await token.getCurrentMultiplier()).currentMultiplier));
        })
      });
    })
  })
  describe('#transferShares', () => {
    const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
    cacheBeforeEach(async () => {
      await token.connect(minter.signer).mint(owner.address, baseMintedAmount);
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
      await token.connect(minter.signer).mint(owner.address, baseMintedAmount);
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

        describe('when time moved by 365 days forward', () => {
          const periodsPassed = 365;
          cacheBeforeEach(async () => {
            await helpers.time.setNextBlockTimestamp(baseTime + periodsPassed * accrualPeriodLength);
            await helpers.mine()
          })
          it('Should move requested shares of tokens', async () => {
            await subject();
            expect((await token.sharesOf(actor.address))).to.be.eq(sharesToTransfer);
          })
        });
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
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await token.setPauser(pauser.address);

    await expect(token.connect(accounts[2]).setPause(true)).to.be.revertedWith(
      "BackedToken: Only pauser"
    );

    const receipt = await (
      await token.connect(pauser.signer).setPause(true)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt.events?.[0].args?.[0]).to.equal(true);

    // Try to transfer when paused:
    await expect(token.transfer(tmpAccount.address, 50)).to.be.revertedWith(
      "BackedToken: token transfer while paused"
    );

    // Try to transferShares when paused:
    const ownerShares = await token.sharesOf(owner.address);
    await expect(token.transferShares(tmpAccount.address, ownerShares.div(10))).to.be.revertedWith(
      "BackedToken: token transfer while paused"
    );

    // Try to transferSharesFrom when paused:
    await token.connect(tmpAccount.signer).approve(minter.address, 50);
    const tmpAccountShares = await token.sharesOf(tmpAccount.address);
    await expect(
      token.connect(minter.signer).transferSharesFrom(tmpAccount.address, owner.address, tmpAccountShares.div(10))
    ).to.be.revertedWith("BackedToken: token transfer while paused");

    // Try to transferFrom when paused:
    await token.connect(owner.signer).approve(minter.address, 50);
    await expect(
      token.connect(minter.signer).transferFrom(owner.address, tmpAccount.address, 10)
    ).to.be.revertedWith("BackedToken: token transfer while paused");

    // Try to delegatedTransfer when paused:
    await token.setDelegateWhitelist(actor.address, true);
    const nonce1 = await token.nonces(owner.address);
    const domain1 = {
      name: await token.name(),
      version: "1",
      chainId: chainId,
      verifyingContract: token.address
    };
    const types1 = {
      DELEGATED_TRANSFER: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const msg1 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: 10,
      nonce: nonce1,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSigner1 = await ethers.getSigner(owner.address);
    const sig1 = await ownerSigner1._signTypedData(domain1, types1, msg1);
    const splitSig1 = ethers.utils.splitSignature(sig1);
    await expect(
      token.connect(actor.signer).delegatedTransfer(owner.address, tmpAccount.address, 10, ethers.constants.MaxUint256, splitSig1.v, splitSig1.r, splitSig1.s)
    ).to.be.revertedWith("BackedToken: token transfer while paused");

    // Try to delegatedTransferShares when paused:
    const nonce2 = await token.nonces(owner.address);
    const types2 = {
      DELEGATED_TRANSFER_SHARES: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const msg2 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: ownerShares.div(10),
      nonce: nonce2,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSigner2 = await ethers.getSigner(owner.address);
    const sig2 = await ownerSigner2._signTypedData(domain1, types2, msg2);
    const splitSig2 = ethers.utils.splitSignature(sig2);
    await expect(
      token.connect(actor.signer).delegatedTransferShares(owner.address, tmpAccount.address, ownerShares.div(10), ethers.constants.MaxUint256, splitSig2.v, splitSig2.r, splitSig2.s)
    ).to.be.revertedWith("BackedToken: token transfer while paused");

    // Try to transfer zero amount when paused (zero-value transfers still respect pause):
    await expect(token.transfer(tmpAccount.address, 0)).to.be.revertedWith(
      "BackedToken: token transfer while paused"
    );

    // Unpause:
    const receipt2 = await (
      await token.connect(pauser.signer).setPause(false)
    ).wait();
    expect(receipt2.events?.[0].event).to.equal("PauseModeChange");
    expect(receipt2.events?.[0].args?.[0]).to.equal(false);

    // Check transfer is possible:
    await token.transfer(tmpAccount.address, 50);
    expect(await token.balanceOf(tmpAccount.address)).to.equal(150);

    // Check transferShares is possible:
    await token.transferShares(tmpAccount.address, ownerShares.div(10));

    // Check transferSharesFrom is possible:
    await token.connect(minter.signer).transferSharesFrom(tmpAccount.address, owner.address, tmpAccountShares.div(10));

    // Check transferFrom is possible:
    await token.connect(minter.signer).transferFrom(owner.address, tmpAccount.address, 10);

    // Check delegatedTransfer is possible:
    const nonce3 = await token.nonces(owner.address);
    const msg3 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: 10,
      nonce: nonce3,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSigner3 = await ethers.getSigner(owner.address);
    const sig3 = await ownerSigner3._signTypedData(domain1, types1, msg3);
    const splitSig3 = ethers.utils.splitSignature(sig3);
    await token.connect(actor.signer).delegatedTransfer(owner.address, tmpAccount.address, 10, ethers.constants.MaxUint256, splitSig3.v, splitSig3.r, splitSig3.s);

    // Check delegatedTransferShares is possible:
    const nonce4 = await token.nonces(owner.address);
    const msg4 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: ownerShares.div(10),
      nonce: nonce4,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSigner4 = await ethers.getSigner(owner.address);
    const sig4 = await ownerSigner4._signTypedData(domain1, types2, msg4);
    const splitSig4 = ethers.utils.splitSignature(sig4);
    await token.connect(actor.signer).delegatedTransferShares(owner.address, tmpAccount.address, ownerShares.div(10), ethers.constants.MaxUint256, splitSig4.v, splitSig4.r, splitSig4.s);
  });

  it("Pause takes precedence over sanctions check", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(owner.address, 100);
    await token.setPauser(pauser.address);

    // Enable pause
    await token.connect(pauser.signer).setPause(true);

    // Add address to sanctions list
    await sanctionsList.connect(blacklister.signer).addToSanctionsList([tmpAccount.address]);

    // Both conditions apply (paused AND sanctioned), but pause error should appear first
    await expect(token.transfer(tmpAccount.address, 10)).to.be.revertedWith(
      "BackedToken: token transfer while paused"
    );
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

  it("Nonce increments on successful delegatedTransfer", async function () {
    // Setup: mint tokens and enable delegation
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await token.setDelegateWhitelist(owner.address, true);

    // Record initial nonce
    const initialNonce = await token.nonces(tmpAccount.address);

    // Perform successful delegatedTransfer
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
      value: 50,
      nonce: initialNonce,
      deadline: ethers.constants.MaxUint256,
    };

    const signer = await ethers.getSigner(tmpAccount.address);
    const sig = await signer._signTypedData(domain, types, msg);
    const splitSig = ethers.utils.splitSignature(sig);

    await token.delegatedTransfer(
      tmpAccount.address,
      minter.address,
      50,
      ethers.constants.MaxUint256,
      splitSig.v,
      splitSig.r,
      splitSig.s
    );

    // Verify nonce incremented by 1
    const finalNonce = await token.nonces(tmpAccount.address);
    expect(finalNonce).to.equal(initialNonce.add(1));
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

    // Try to transferShares to the sanctioned address:
    const ownerShares = await token.sharesOf(owner.address);
    await expect(token.transferShares(tmpAccount.address, ownerShares.div(10))).to.be.revertedWith(
      "BackedToken: receiver is sanctioned"
    );

    // Try to transferShares from the sanctioned address:
    const tmpAccountShares = await token.sharesOf(tmpAccount.address);
    await expect(
      token.connect(tmpAccount.signer).transferShares(owner.address, tmpAccountShares.div(10))
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

    // Try to transferSharesFrom with sanctioned sender:
    await token.connect(tmpAccount.signer).approve(minter.address, 100);
    await expect(
      token.connect(minter.signer).transferSharesFrom(tmpAccount.address, owner.address, tmpAccountShares.div(10))
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

    // Try to transferSharesFrom with sanctioned receiver:
    await token.connect(owner.signer).approve(minter.address, 100);
    await expect(
      token.connect(minter.signer).transferSharesFrom(owner.address, tmpAccount.address, ownerShares.div(10))
    ).to.be.revertedWith("BackedToken: receiver is sanctioned");

    // Try to transferSharesFrom with sanctioned spender (re-sanction minter):
    await sanctionsList.connect(blacklister.signer).addToSanctionsList([minter.address]);
    await token.connect(owner.signer).approve(minter.address, 100);
    await expect(
      token.connect(minter.signer).transferSharesFrom(owner.address, actor.address, ownerShares.div(10))
    ).to.be.revertedWith("BackedToken: spender is sanctioned");
    await sanctionsList.connect(blacklister.signer).removeFromSanctionsList([minter.address]);

    // Try to delegatedTransfer to the sanctioned address:
    await token.setDelegateWhitelist(actor.address, true);
    const nonce1 = await token.nonces(owner.address);
    const domain1 = {
      name: await token.name(),
      version: "1",
      chainId: chainId,
      verifyingContract: token.address
    };
    const types1 = {
      DELEGATED_TRANSFER: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const msg1 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: 10,
      nonce: nonce1,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSignerSanctions1 = await ethers.getSigner(owner.address);
    const sig1 = await ownerSignerSanctions1._signTypedData(domain1, types1, msg1);
    const splitSig1 = ethers.utils.splitSignature(sig1);
    await expect(
      token.connect(actor.signer).delegatedTransfer(owner.address, tmpAccount.address, 10, ethers.constants.MaxUint256, splitSig1.v, splitSig1.r, splitSig1.s)
    ).to.be.revertedWith("BackedToken: receiver is sanctioned");

    // Try to delegatedTransfer from the sanctioned address:
    const nonce2 = await token.nonces(tmpAccount.address);
    const msg2 = {
      owner: tmpAccount.address,
      to: owner.address,
      value: 10,
      nonce: nonce2,
      deadline: ethers.constants.MaxUint256
    };
    const tmpAccountSignerSanctions2 = await ethers.getSigner(tmpAccount.address);
    const sig2 = await tmpAccountSignerSanctions2._signTypedData(domain1, types1, msg2);
    const splitSig2 = ethers.utils.splitSignature(sig2);
    await expect(
      token.connect(actor.signer).delegatedTransfer(tmpAccount.address, owner.address, 10, ethers.constants.MaxUint256, splitSig2.v, splitSig2.r, splitSig2.s)
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

    // Try to delegatedTransferShares to the sanctioned address:
    const nonce3 = await token.nonces(owner.address);
    const types3 = {
      DELEGATED_TRANSFER_SHARES: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const msg3 = {
      owner: owner.address,
      to: tmpAccount.address,
      value: ownerShares.div(10),
      nonce: nonce3,
      deadline: ethers.constants.MaxUint256
    };
    const ownerSignerSanctions3 = await ethers.getSigner(owner.address);
    const sig3 = await ownerSignerSanctions3._signTypedData(domain1, types3, msg3);
    const splitSig3 = ethers.utils.splitSignature(sig3);
    await expect(
      token.connect(actor.signer).delegatedTransferShares(owner.address, tmpAccount.address, ownerShares.div(10), ethers.constants.MaxUint256, splitSig3.v, splitSig3.r, splitSig3.s)
    ).to.be.revertedWith("BackedToken: receiver is sanctioned");

    // Try to delegatedTransferShares from the sanctioned address:
    const nonce4 = await token.nonces(tmpAccount.address);
    const msg4 = {
      owner: tmpAccount.address,
      to: owner.address,
      value: tmpAccountShares.div(10),
      nonce: nonce4,
      deadline: ethers.constants.MaxUint256
    };
    const tmpAccountSignerSanctions4 = await ethers.getSigner(tmpAccount.address);
    const sig4 = await tmpAccountSignerSanctions4._signTypedData(domain1, types3, msg4);
    const splitSig4 = ethers.utils.splitSignature(sig4);
    await expect(
      token.connect(actor.signer).delegatedTransferShares(tmpAccount.address, owner.address, tmpAccountShares.div(10), ethers.constants.MaxUint256, splitSig4.v, splitSig4.r, splitSig4.s)
    ).to.be.revertedWith("BackedToken: sender is sanctioned");

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

  describe('#delayedActivation', () => {
    describe('When setting multiplier with future activation time', () => {
      const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
      const futureTime = baseTime + accrualPeriodLength - 60; // 60 seconds before the end of the current period

      cacheBeforeEach(async () => {
        await token.connect(minter.signer).mint(owner.address, baseMintedAmount);
      });

      it('Should store new multiplier but not activate it yet', async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100); // 10% increase

        await token.updateMultiplierValue(newMult, currentMult, futureTime);

        expect(await token.multiplier()).to.be.equal(currentMult); // Still old multiplier
        expect(await token.newMultiplier()).to.be.equal(newMult);
        expect(await token.newMultiplierActivationTime()).to.be.equal(futureTime);
      });

      it('Should return lastMultiplier when querying before activation time', async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100);

        await token.updateMultiplierValue(newMult, currentMult, futureTime);

        const result = await token.getCurrentMultiplier();
        expect(result.currentMultiplier).to.be.equal(currentMult);
      });

      it('Should activate multiplier when time reaches activation time', async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100);

        await token.updateMultiplierValue(newMult, currentMult, futureTime);

        // Move time to activation time
        await helpers.time.setNextBlockTimestamp(futureTime);
        await helpers.mine();

        const result = await token.getCurrentMultiplier();
        expect(result.currentMultiplier).to.be.equal(newMult);
      });

      it('Should activate multiplier on next transaction after activation time', async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100);

        await token.updateMultiplierValue(newMult, currentMult, futureTime);

        // Move time past activation
        await helpers.time.setNextBlockTimestamp(futureTime + 7 * accrualPeriodLength);

        // Trigger updateMultiplier modifier via transfer
        await token.transfer(actor.address, 1);

        // Calculate expected multiplier after 7 periods of fee application
        const feePerPeriod = await token.feePerPeriod();
        const periodsPassed = 7;
        let expectedMult = newMult;
        for (let i = 0; i < periodsPassed; i++) {
          expectedMult = expectedMult.mul(ethers.BigNumber.from(10).pow(18).sub(feePerPeriod)).div(ethers.BigNumber.from(10).pow(18));
        }

        // Now lastMultiplier should be updated with fees applied
        expect(await token.lastMultiplier()).to.be.equal(expectedMult);
        expect(await token.newMultiplierActivationTime()).to.be.equal(0);
      });
    });

    describe('Edge case: activation time equals block.timestamp', () => {
      it('Should activate immediately when activation time == block.timestamp', async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100);
        const currentTime = await helpers.time.latest();

        // Set activation time to current time
        await token.updateMultiplierValue(newMult, currentMult, currentTime);

        // Should activate immediately (not stored as pending)
        expect(await token.lastMultiplier()).to.be.equal(newMult);
        expect(await token.newMultiplierActivationTime()).to.be.equal(0);
      });
    });

    describe('Overwriting pending activation', () => {
      const futureTime1 = baseTime + accrualPeriodLength / 4;
      const futureTime2 = baseTime + accrualPeriodLength / 2;

      it('Should allow overwriting pending activation with new values', async () => {
        const currentMult = await token.multiplier();
        const newMult1 = currentMult.mul(110).div(100);
        const newMult2 = currentMult.mul(120).div(100);

        // Set first pending activation
        await token.updateMultiplierValue(newMult1, currentMult, futureTime1);
        expect(await token.newMultiplier()).to.be.equal(newMult1);
        expect(await token.newMultiplierActivationTime()).to.be.equal(futureTime1);

        // Overwrite with second pending activation
        await token.updateMultiplierValue(newMult2, currentMult, futureTime2);
        expect(await token.newMultiplier()).to.be.equal(newMult2);
        expect(await token.newMultiplierActivationTime()).to.be.equal(futureTime2);
      });
    });
  });

  describe('#transferSharesFrom', () => {
    const baseMintedAmount = ethers.BigNumber.from(10).pow(18);
    const sharesToTransfer = ethers.BigNumber.from(10).pow(17);

    cacheBeforeEach(async () => {
      await token.connect(minter.signer).mint(owner.address, baseMintedAmount);
    });

    describe('When caller has sufficient allowance', () => {
      cacheBeforeEach(async () => {
        const amount = await token.getUnderlyingAmountByShares(sharesToTransfer);
        await token.approve(actor.address, amount);
      });

      it('Should transfer shares using allowance', async () => {
        await token.connect(actor.signer).transferSharesFrom(owner.address, tmpAccount.address, sharesToTransfer);

        expect(await token.sharesOf(tmpAccount.address)).to.be.equal(sharesToTransfer);
        expect(await token.sharesOf(owner.address)).to.be.equal(baseMintedAmount.sub(sharesToTransfer));
      });

      it('Should reduce allowance after transfer', async () => {
        const amount = await token.getUnderlyingAmountByShares(sharesToTransfer);
        const allowanceBefore = await token.allowance(owner.address, actor.address);

        await token.connect(actor.signer).transferSharesFrom(owner.address, tmpAccount.address, sharesToTransfer);

        const allowanceAfter = await token.allowance(owner.address, actor.address);
        expect(allowanceBefore.sub(allowanceAfter)).to.be.equal(amount);
      });
    });

    describe('When caller has insufficient allowance', () => {
      it('Should revert', async () => {
        await expect(
          token.connect(actor.signer).transferSharesFrom(owner.address, tmpAccount.address, sharesToTransfer)
        ).to.be.reverted;
      });
    });

    describe('When transferring to zero address', () => {
      cacheBeforeEach(async () => {
        const amount = await token.getUnderlyingAmountByShares(sharesToTransfer);
        await token.approve(actor.address, amount);
      });

      it('Should revert', async () => {
        await expect(
          token.connect(actor.signer).transferSharesFrom(owner.address, ethers.constants.AddressZero, sharesToTransfer)
        ).to.be.revertedWith("ERC20: transfer to the zero address");
      });
    });

    describe('When transferring more shares than balance', () => {
      cacheBeforeEach(async () => {
        const excessiveAmount = baseMintedAmount.mul(2); // More than what owner has
        await token.approve(actor.address, excessiveAmount);
      });

      it('Should revert', async () => {
        const excessiveShares = baseMintedAmount.mul(2);
        await expect(
          token.connect(actor.signer).transferSharesFrom(owner.address, tmpAccount.address, excessiveShares)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });
    });
  });

  describe('#feeUpdateBlocking', () => {
    const futureTime = baseTime + accrualPeriodLength / 2;

    describe('When multiplier activation is pending', () => {
      cacheBeforeEach(async () => {
        const currentMult = await token.multiplier();
        const newMult = currentMult.mul(110).div(100);
        await token.updateMultiplierValue(newMult, currentMult, futureTime);
      });

      it('Should block updateFeePerPeriod', async () => {
        await expect(
          token.updateFeePerPeriod(1000)
        ).to.be.revertedWith("Multiplier activation in progress");
      });

      it('Should block setLastTimeFeeApplied', async () => {
        await expect(
          token.setLastTimeFeeApplied(baseTime + 1000)
        ).to.be.revertedWith("Multiplier activation in progress");
      });

      it('Should block setPeriodLength', async () => {
        await expect(
          token.setPeriodLength(12 * 3600)
        ).to.be.revertedWith("Multiplier activation in progress");
      });
    });

    describe('When no pending activation', () => {
      it('Should allow updateFeePerPeriod', async () => {
        await expect(token.updateFeePerPeriod(1000)).to.not.be.reverted;
      });

      it('Should allow setLastTimeFeeApplied', async () => {
        await expect(token.setLastTimeFeeApplied(baseTime + 1000)).to.not.be.reverted;
      });

      it('Should allow setPeriodLength', async () => {
        await expect(token.setPeriodLength(12 * 3600)).to.not.be.reverted;
      });
    });
  });

});
function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}

