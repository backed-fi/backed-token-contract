/* eslint-disable camelcase */
/* eslint-disable prettier/prettier */
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import Decimal from "decimal.js";

import {
  BackedAutoFeeTokenImplementation,
  BackedAutoFeeTokenImplementation__factory,
  BackedTokenProxy__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  SanctionsListMock,
  SanctionsListMock__factory,
  WrappedBackedTokenFactory,
  WrappedBackedTokenFactory__factory,
  WrappedBackedTokenImplementation,
  WrappedBackedTokenImplementation__factory,
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("WrappedBackedTokenFactory", function () {
  const annualFee = 0.5;
  const multiplierAdjustmentPerPeriod = nthRoot(annualFee, 365).mul(
    Decimal.pow(10, 18)
  );
  const baseFeePerPeriod = Decimal.pow(10, 18)
    .minus(multiplierAdjustmentPerPeriod)
    .toFixed(0);
  const baseTime = 2_200_000_000;

  const tokenName = "Backed Apple";
  const tokenSymbol = "bAAPL";
  const wrappedTokenName = `Wrapped ${tokenName}`;
  const wrappedTokenSymbol = `w${tokenSymbol}`;

  let factory: WrappedBackedTokenFactory;
  let wrappedImplementation: WrappedBackedTokenImplementation;
  let underlying: BackedAutoFeeTokenImplementation;
  let underlyingProxyAdmin: ProxyAdmin;
  let sanctionsList: SanctionsListMock;

  let owner: SignerWithAddress;
  let proxyAdminOwner: SignerWithAddress;
  let tokenOwner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    const getSigner = async (i: number): Promise<SignerWithAddress> => ({
      signer: accounts[i],
      address: await accounts[i].getAddress(),
    });

    owner = await getSigner(0);
    proxyAdminOwner = await getSigner(1);
    tokenOwner = await getSigner(2);
    pauser = await getSigner(3);
    other = await getSigner(4);

    await helpers.time.setNextBlockTimestamp(baseTime);

    // Deploy underlying auto-fee token (used as the wrapped asset).
    const underlyingImpl = await new BackedAutoFeeTokenImplementation__factory(
      owner.signer
    ).deploy();
    underlyingProxyAdmin = await new ProxyAdmin__factory(owner.signer).deploy();
    const underlyingProxy = await new BackedTokenProxy__factory(
      owner.signer
    ).deploy(
      underlyingImpl.address,
      underlyingProxyAdmin.address,
      underlyingImpl.interface.encodeFunctionData(
        "initialize(string,string,uint256,uint256,uint256)",
        [tokenName, tokenSymbol, 24 * 3600, baseTime, baseFeePerPeriod]
      )
    );
    underlying = BackedAutoFeeTokenImplementation__factory.connect(
      underlyingProxy.address,
      owner.signer
    );

    sanctionsList = await new SanctionsListMock__factory(owner.signer).deploy();

    wrappedImplementation = await new WrappedBackedTokenImplementation__factory(
      owner.signer
    ).deploy();

    factory = await new WrappedBackedTokenFactory__factory(owner.signer).deploy(
      proxyAdminOwner.address
    );
  });

  afterEach(async () => {
    await helpers.reset();
  });

  const buildConfig = (overrides: Partial<{
    name: string;
    symbol: string;
    underlying: string;
    tokenOwner: string;
    pauser: string;
  }> = {}) => ({
    name: wrappedTokenName,
    symbol: wrappedTokenSymbol,
    underlying: underlying.address,
    tokenOwner: tokenOwner.address,
    pauser: pauser.address,
    ...overrides,
  });

  describe("#constructor", () => {
    it("should set deployer as factory owner", async () => {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("should deploy a ProxyAdmin owned by proxyAdminOwner", async () => {
      const proxyAdmin = await ethers.getContractAt(
        "ProxyAdmin",
        await factory.proxyAdmin()
      );
      expect(await proxyAdmin.owner()).to.equal(proxyAdminOwner.address);
    });

    it("should expose the deployed ProxyAdmin via proxyAdmin()", async () => {
      const proxyAdminAddress = await factory.proxyAdmin();
      expect(proxyAdminAddress).to.match(/^0x[a-fA-F\d]{40}$/);
      expect(proxyAdminAddress).to.not.equal(ethers.constants.AddressZero);
    });

    it("should leave wrappedTokenImplementation unset by default", async () => {
      expect(await factory.wrappedTokenImplementation()).to.equal(
        ethers.constants.AddressZero
      );
    });

    it("should revert when proxyAdminOwner is zero address", async () => {
      await expect(
        new WrappedBackedTokenFactory__factory(owner.signer).deploy(
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Factory: address should not be 0");
    });
  });

  describe("#updateImplementation", () => {
    it("should set the implementation and emit NewImplementation", async () => {
      await expect(
        factory.updateImplementation(wrappedImplementation.address)
      )
        .to.emit(factory, "NewImplementation")
        .withArgs(wrappedImplementation.address);

      expect(await factory.wrappedTokenImplementation()).to.equal(
        wrappedImplementation.address
      );
    });

    it("should allow swapping the implementation", async () => {
      await factory.updateImplementation(wrappedImplementation.address);

      const newImpl = await new WrappedBackedTokenImplementation__factory(
        owner.signer
      ).deploy();

      await expect(factory.updateImplementation(newImpl.address))
        .to.emit(factory, "NewImplementation")
        .withArgs(newImpl.address);

      expect(await factory.wrappedTokenImplementation()).to.equal(
        newImpl.address
      );
    });

    it("should revert when implementation is zero address", async () => {
      await expect(
        factory.updateImplementation(ethers.constants.AddressZero)
      ).to.be.revertedWith("Factory: address should not be 0");
    });

    it("should revert when called by non-owner", async () => {
      await expect(
        factory
          .connect(other.signer)
          .updateImplementation(wrappedImplementation.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("#deployToken", () => {
    beforeEach(async () => {
      await factory.updateImplementation(wrappedImplementation.address);
    });

    const deploy = async (overrides = {}) => {
      const tx = await factory.deployToken(buildConfig(overrides));
      const receipt = await tx.wait();
      const event = receipt.events?.find((e) => e.event === "NewToken");
      return {
        receipt,
        event,
        address: event?.args?.newToken as string,
      };
    };

    it("should emit NewToken with the deployed proxy address, name and symbol", async () => {
      const { event, address } = await deploy();

      expect(event).to.not.be.undefined;
      expect(address).to.match(/^0x[a-fA-F\d]{40}$/);
      expect(event?.args?.name).to.equal(wrappedTokenName);
      expect(event?.args?.symbol).to.equal(wrappedTokenSymbol);
    });

    it("should initialize the wrapped token state", async () => {
      const { address } = await deploy();
      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        address,
        owner.signer
      );

      expect(await wrapped.name()).to.equal(wrappedTokenName);
      expect(await wrapped.symbol()).to.equal(wrappedTokenSymbol);
      expect(await wrapped.asset()).to.equal(underlying.address);
      expect(await wrapped.decimals()).to.equal(await underlying.decimals());
    });

    it("should configure roles and ownership", async () => {
      const { address } = await deploy();
      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        address,
        owner.signer
      );

      expect(await wrapped.owner()).to.equal(tokenOwner.address);
      expect(await wrapped.pauser()).to.equal(pauser.address);
    });

    it("should hand the proxy admin role to the factory's ProxyAdmin", async () => {
      const { address } = await deploy();
      const proxyAdminAddress = await factory.proxyAdmin();
      const proxyAdmin = await ethers.getContractAt(
        "ProxyAdmin",
        proxyAdminAddress
      );

      expect(await proxyAdmin.getProxyAdmin(address)).to.equal(
        proxyAdminAddress
      );
      expect(await proxyAdmin.getProxyImplementation(address)).to.equal(
        wrappedImplementation.address
      );
    });

    it("should let the ProxyAdmin owner upgrade the deployed token", async () => {
      const { address } = await deploy();
      const proxyAdmin = await ethers.getContractAt(
        "ProxyAdmin",
        await factory.proxyAdmin()
      );

      const newImpl = await new WrappedBackedTokenImplementation__factory(
        owner.signer
      ).deploy();

      await proxyAdmin
        .connect(proxyAdminOwner.signer)
        .upgrade(address, newImpl.address);

      expect(await proxyAdmin.getProxyImplementation(address)).to.equal(
        newImpl.address
      );

      // Storage must survive the upgrade.
      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        address,
        owner.signer
      );
      expect(await wrapped.name()).to.equal(wrappedTokenName);
      expect(await wrapped.owner()).to.equal(tokenOwner.address);
    });

    it("should revert when redeploying with the same name/symbol/underlying (CREATE2 salt collision)", async () => {
      const config = buildConfig();
      await factory.deployToken(config);
      await expect(factory.deployToken(config)).to.be.reverted;
    });

    it("should allow deploying multiple tokens with different inputs", async () => {
      const { address: a1 } = await deploy({ symbol: "wbAAPL1" });
      const { address: a2 } = await deploy({ symbol: "wbAAPL2" });
      expect(a1).to.not.equal(a2);
    });

    it("should let the configured pauser pause the freshly-deployed token", async () => {
      const { address } = await deploy();
      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        address,
        owner.signer
      );

      await expect(wrapped.connect(pauser.signer).setPause(true))
        .to.emit(wrapped, "PauseModeChange")
        .withArgs(true);
      expect(await wrapped.isPaused()).to.equal(true);
    });

    it("should leave the factory unable to call owner-only functions on the new token", async () => {
      const { address } = await deploy();
      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        address,
        owner.signer
      );

      // Ownership was transferred to tokenOwner; the deployer (and even the
      // factory itself) cannot reconfigure the token.
      await expect(
        wrapped.connect(owner.signer).setPauser(other.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert when tokenOwner is zero address", async () => {
      await expect(
        factory.deployToken(
          buildConfig({ tokenOwner: ethers.constants.AddressZero })
        )
      ).to.be.revertedWith("Factory: address should not be 0");
    });

    it("should revert when underlying is zero address", async () => {
      await expect(
        factory.deployToken(
          buildConfig({ underlying: ethers.constants.AddressZero })
        )
      ).to.be.revertedWith("Factory: address should not be 0");
    });

    it("should revert when pauser is zero address", async () => {
      await expect(
        factory.deployToken(
          buildConfig({ pauser: ethers.constants.AddressZero })
        )
      ).to.be.revertedWith("Factory: address should not be 0");
    });

    it("should revert when called by non-owner", async () => {
      await expect(
        factory.connect(other.signer).deployToken(buildConfig())
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert when implementation has not been set", async () => {
      // Use a fresh factory without an implementation configured.
      const fresh = await new WrappedBackedTokenFactory__factory(
        owner.signer
      ).deploy(proxyAdminOwner.address);

      await expect(fresh.deployToken(buildConfig())).to.be.reverted;
    });
  });

  describe("end-to-end flow", () => {
    it("supports a full deposit roundtrip on a factory-deployed token", async () => {
      await factory.updateImplementation(wrappedImplementation.address);

      const tx = await factory.deployToken(buildConfig());
      const receipt = await tx.wait();
      const tokenAddr = receipt.events?.find((e) => e.event === "NewToken")
        ?.args?.newToken as string;

      const wrapped = WrappedBackedTokenImplementation__factory.connect(
        tokenAddr,
        owner.signer
      );

      // Wire up the underlying so the deposit path can run.
      await underlying.setMinter(owner.address);
      await underlying.setSanctionsList(sanctionsList.address);
      const amount = ethers.BigNumber.from(10).pow(18).mul(100);
      await underlying.mint(owner.address, amount);
      await underlying.approve(wrapped.address, amount);

      await wrapped.deposit(amount, owner.address);
      expect(await wrapped.balanceOf(owner.address)).to.be.gt(0);
    });
  });
});

function nthRoot(annualFee: number, n: number) {
  return Decimal.pow(1 - annualFee, new Decimal(1).div(n));
}
