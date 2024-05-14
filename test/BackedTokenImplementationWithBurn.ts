import { BackedTokenImplementation__factory } from './../typechain/factories/BackedTokenImplementation__factory';
import { ProxyAdmin__factory } from './../typechain/factories/ProxyAdmin__factory';
import { ProxyAdmin } from './../typechain/ProxyAdmin.d';
import { BackedTokenImplementationWithBurn__factory } from './../typechain/factories/BackedTokenImplementationWithBurn__factory';
import { BackedTokenImplementationWithBurn } from './../typechain/BackedTokenImplementationWithBurn.d';
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, Signer } from "ethers";
import {
  AggregatorV2V3Interface,
  BackedOracle,
  BackedOracleFactory,
  BackedOracleFactory__factory,
  BackedOracle__factory,
  BackedTokenImplementation,
  TimelockController__factory,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { cacheBeforeEach } from "./helpers";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

const oneHour = 3600;
const validOracleDeployArgs = [8, "Backed Test Oracle"] as const;
const validUpdateAnswerArgs = [
  100000,
  Math.round(new Date().getTime() / 1000),
] as const;

describe.only("BackedTokenImplementationWithBurn", function () {
  const ownerGnosisSafe = '0x22f2dFE84a2EaCfE5d3cA81d26E610CB94eB1603'
  const implementationContractAddressToReplace = '1cAaB9EdD83800aeA2AF79Dd29771ed7A4C8CA33'
  const workingCapitalAddress = '0x5f7a4c11bde4f218f0025ef444c369d838ffa2ad';
  const safeOwnerAddress = '0xd49fbb0711e91ef730c23f0d2fef4e5c5bf96eb1';
  const amountToReissue = '20057130747592133103436';

  // General config:
  let token: BackedTokenImplementationWithBurn;
  let newImplementation: BackedTokenImplementationWithBurn;
  let oldImplementation: BackedTokenImplementation;
  let proxyAdmin: ProxyAdmin;
  let accounts: Signer[];

  let owner: SignerWithAddress;
  let workingCapitalSigner: Signer;
  let safeOwner: Signer;
  let totalSupply: BigNumber;

  cacheBeforeEach(async () => {
    accounts = await ethers.getSigners();

    const getSigner = async (index: number): Promise<SignerWithAddress> => ({
      signer: accounts[index],
      address: await accounts[index].getAddress(),
    });

    owner = await getSigner(0);

    token = BackedTokenImplementationWithBurn__factory.connect('0xCA30c93B02514f86d5C86a6e375E3A330B435Fb5', owner.signer);
    proxyAdmin = ProxyAdmin__factory.connect('0xF2057bDFF8439dBfFCe073e14A9854945D5E5644', owner.signer)

    oldImplementation = BackedTokenImplementation__factory.connect(await proxyAdmin.getProxyImplementation(token.address), owner.signer);
    newImplementation = await new BackedTokenImplementationWithBurn__factory(owner.signer).deploy();

    totalSupply = await token.totalSupply();

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [workingCapitalAddress],

    })
    workingCapitalSigner = await ethers.getSigner(workingCapitalAddress);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [safeOwnerAddress],
    })
    safeOwner = await ethers.getSigner(safeOwnerAddress);

    await token.connect(workingCapitalSigner).transfer(ownerGnosisSafe, amountToReissue)

    // Reduce multisig owner threshold to 1
    await network.provider.send("hardhat_setStorageAt", [
      ownerGnosisSafe,
      "0x4",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ]);

    await safeOwner.sendTransaction({
      to: ownerGnosisSafe,
      data: '0x6a7612020000000000000000000000009641d764fc13c8b624c04430c7356c1c7c8102e200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000056000000000000000000000000000000000000000000000000000000000000003e48d80ff0a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000039600f2057bdff8439dbffce073e14a9854945d5e56440000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004499a88ec4000000000000000000000000ca30c93b02514f86d5c86a6e375e3a330b435fb50000000000000000000000001caab9edd83800aea2af79dd29771ed7a4c8ca3300ca30c93b02514f86d5c86a6e375e3a330b435fb50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004459dc2dd2000000000000000000000000c4cafefbc3dfea629c589728d648cb6111db31360000000000000000000000000000000000000000000002e80f770312c76f981900ca30c93b02514f86d5c86a6e375e3a330b435fb50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004459dc2dd20000000000000000000000008dc5be35672d650bc8a176a4bafbfc33555d80ac000000000000000000000000000000000000000000000039e5f65b3a0b5c7bec00ca30c93b02514f86d5c86a6e375e3a330b435fb50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004459dc2dd2000000000000000000000000f9131141e9f2e89211e87b83af231a0310922a1800000000000000000000000000000000000000000000011d572d6566df4cbb4700f2057bdff8439dbffce073e14a9854945d5e56440000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004499a88ec4000000000000000000000000ca30c93b02514f86d5c86a6e375e3a330b435fb500000000000000000000000028a0b491650fe761c8a66528422bc7ca24ecaeda00ca30c93b02514f86d5c86a6e375e3a330b435fb500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000fd10048dadf5fda5024950e678206c9c14865dc000000000000000000000000000000000000000000000043f4c9ac3b3b218cf4c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000410000000000000000000000002860a2051a93113cb6e931022b658ed1dc68d44400000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000'
        .replace(implementationContractAddressToReplace.toLowerCase(), newImplementation.address.toLowerCase().substring(2))
        .replace('2860a2051a93113cb6e931022b658ed1dc68d444'.toLowerCase(), safeOwnerAddress.toLowerCase().substring(2))

    })
  });

  it("should still have original implementation assigned", async () => {
    expect(await proxyAdmin.getProxyImplementation(token.address)).to.eq(oldImplementation.address);
  });

  it("should be unable to call burnFromAccount function", async () => {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ownerGnosisSafe],
    })
    const safeSigner = await ethers.getSigner(ownerGnosisSafe);
    await owner.signer.sendTransaction({
      to: ownerGnosisSafe,
      value: '1000000000000000000'
    })
    await expect(token.connect(safeSigner).burnFromAccount(workingCapitalAddress, 1)).to.be.reverted;
  });

  it("should reduce supply by burned amount", async () => {
    expect(await token.totalSupply()).to.eq(totalSupply.sub(amountToReissue));
  });

  it("should transfer burned amount to provided address", async () => {
    expect(await token.balanceOf('0xfd10048DADf5FdA5024950e678206C9c14865dc0')).to.eq(amountToReissue);
  });

  it("should remove balance of requested 3 contracts", async () => {
    expect(await token.balanceOf('0xC4cafEFBc3dfeA629c589728d648CB6111DB3136')).to.eq(0);
    expect(await token.balanceOf('0x8dc5BE35672D650bc8A176A4bafBfC33555D80AC')).to.eq(0);
    expect(await token.balanceOf('0xF9131141E9f2e89211E87B83Af231a0310922a18')).to.eq(0);
  });
});
