import { ProxyAdmin__factory } from '../typechain/factories/ProxyAdmin__factory';
import { ProxyAdmin } from '../typechain/ProxyAdmin';
import { BackedTokenImplementationWithMultiplierAndAutoFeeAccrual__factory } from '../typechain/factories/BackedTokenImplementationWithMultiplierAndAutoFeeAccrual__factory';
import { BackedTokenImplementationWithMultiplierAndAutoFeeAccrual } from '../typechain/BackedTokenImplementationWithMultiplierAndAutoFeeAccrual';
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  BackedTokenProxy__factory,
  SanctionsListMock__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { cacheBeforeEach } from "./helpers";
import Decimal from 'decimal.js';

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

// BackedTokenImplementationWithMultiplierAndAutoFeeAccrual specifications
// Vast majority of comparisons are done with adjustment for precision of calculations, thus we are rather comparing difference of values,
// rather than values themselves
describe.only("BackedTokenImplementationWithMultiplierAndAutoFeeAccrual", function () {
  const accrualPeriodLength = 24 * 3600;
  const annualFee = 0.5;
  const multiplierAdjustmentPerPeriod = nthRoot(annualFee, 365).mul(Decimal.pow(10, 18));
  const baseFeePerPeriod = Decimal.pow(10, 18).minus(multiplierAdjustmentPerPeriod).toFixed(0);
  const baseTime = 2_000_000_000;

  // General config:
  let token: BackedTokenImplementationWithMultiplierAndAutoFeeAccrual;
  let proxyAdmin: ProxyAdmin;
  let accounts: Signer[];

  let owner: SignerWithAddress;
  let actor: SignerWithAddress;

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);
    actor = await getSigner(1);

    await helpers.time.setNextBlockTimestamp(baseTime);

    const tokenImplementationFactory = new BackedTokenImplementationWithMultiplierAndAutoFeeAccrual__factory(owner.signer);
    const tokenImplementation = await tokenImplementationFactory.deploy();
    const proxyAdminFactory = new ProxyAdmin__factory(owner.signer)
    proxyAdmin = await proxyAdminFactory.deploy();
    const tokenProxy = await new BackedTokenProxy__factory(owner.signer).deploy(tokenImplementation.address, proxyAdmin.address, tokenImplementation.interface.encodeFunctionData(
      'initialize',
      [
        "Backed Test Token",
        "bTest",
        baseTime,
        accrualPeriodLength
      ]
    ));
    token = BackedTokenImplementationWithMultiplierAndAutoFeeAccrual__factory.connect(tokenProxy.address, owner.signer);
    await token.setMinter(owner.address);
    await token.setBurner(owner.address);
    await token.setPauser(owner.address);
    await token.setMultiplierUpdater(owner.address);
    await token.setSanctionsList((await new SanctionsListMock__factory(owner.signer).deploy()).address);
    await token.updateFeePerPeriod(baseFeePerPeriod);

  });
  describe('#updateModifier', () => {
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
});
function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}

