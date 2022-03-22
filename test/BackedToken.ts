import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
// eslint-disable-next-line node/no-missing-import
import { BackedToken } from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedToken", function () {
  // General config:
  let token: BackedToken;
  let accounts: Signer[];

  // Basic config:
  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";
  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let tmpAccount: SignerWithAddress;
  let chainId: BigNumber;

  beforeEach(async () => {
    const Token = await ethers.getContractFactory("BackedToken");
    token = await Token.deploy(tokenName, tokenSymbol);
    await token.deployed();
    accounts = await ethers.getSigners();
    owner = { signer: accounts[0], address: await accounts[0].getAddress() };
    minter = { signer: accounts[1], address: await accounts[1].getAddress() };
    burner = { signer: accounts[2], address: await accounts[2].getAddress() };
    tmpAccount = {
      signer: accounts[3],
      address: await accounts[3].getAddress(),
    };
    const network = await ethers.provider.getNetwork();
    chainId = BigNumber.from(network.chainId);
  });

  it("Basic information check", async function () {
    expect(await token.name()).to.equal(tokenName);
    expect(await token.symbol()).to.equal(tokenSymbol);
    expect(await token.owner()).to.equal(owner.address);
  });

  it("Define Minter and transfer Minter", async function () {
    // Set Minter
    let recipt = await (await token.setMinter(minter.address)).wait();
    expect(recipt.events?.[0].event).to.equal("NewMinter");
    expect(recipt.events?.[0].args?.[0]).to.equal(minter.address);
    expect(await token.minter()).to.equal(minter.address);

    // Change Minter
    recipt = await (await token.setMinter(tmpAccount.address)).wait();
    expect(recipt.events?.[0].event).to.equal("NewMinter");
    expect(recipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
  });

  it("Try to define Minter from wrong address", async function () {
    await expect(
      token.connect(accounts[3]).setMinter(minter.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Mint", async function () {
    await token.setMinter(minter.address);
    const recipt = await (
      await token.connect(minter.signer).mint(tmpAccount.address, 100)
    ).wait();

    expect(recipt.events?.[0].event).to.equal("Transfer");
    expect(recipt.events?.[0].args?.[0]).to.equal(ethers.constants.AddressZero);
    expect(recipt.events?.[0].args?.[1]).to.equal(tmpAccount.address);
    expect(recipt.events?.[0].args?.[2]).to.equal(100);
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
    let recipt = await (await token.setBurner(burner.address)).wait();
    expect(recipt.events?.[0].event).to.equal("NewBurner");
    expect(recipt.events?.[0].args?.[0]).to.equal(burner.address);
    expect(await token.burner()).to.equal(burner.address);

    // Change Burner
    recipt = await (await token.setBurner(tmpAccount.address)).wait();
    expect(recipt.events?.[0].event).to.equal("NewBurner");
    expect(recipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
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
    const recipt = await (
      await token.connect(burner.signer).burn(burner.address, 10)
    ).wait();

    expect(recipt.events?.[0].event).to.equal("Transfer");
    expect(recipt.events?.[0].args?.[0]).to.equal(burner.address);
    expect(recipt.events?.[0].args?.[1]).to.equal(ethers.constants.AddressZero);
    expect(recipt.events?.[0].args?.[2]).to.equal(10);
    expect(await token.balanceOf(burner.address)).to.equal(90);
  });

  it("Burn from the token contract balance", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(token.address, 100);
    await token.setBurner(burner.address);
    const recipt = await (
      await token.connect(burner.signer).burn(token.address, 10)
    ).wait();

    expect(recipt.events?.[0].event).to.equal("Transfer");
    expect(recipt.events?.[0].args?.[0]).to.equal(token.address);
    expect(recipt.events?.[0].args?.[1]).to.equal(ethers.constants.AddressZero);
    expect(recipt.events?.[0].args?.[2]).to.equal(10);
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

  it("ERC712 Domain Separator", async function () {
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

  it("ERC712 TypeHashs", async function () {
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

  it("Permit ERC712 test", async function () {
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
      // DelegatedTransfer: [
      //   { name: "owner", type: "address" },
      //   { name: "to", type: "address" },
      //   { name: "value", type: "uint256" },
      //   { name: "nonce", type: "uint256" },
      //   // { name: "deadline", type: "uint256" },
      // ],
    };

    const msg = {
      owner: tmpAccount.address,
      spender: minter.address,
      value: 100,
      nonce: 0,
      deadline: ethers.constants.MaxUint256,
    };

    const signer = await ethers.getSigner(tmpAccount.address);
    const sig = await signer._signTypedData(domain, types, msg);
    const splitSig = ethers.utils.splitSignature(sig);
    await token.setDelegateMode(true);
    await token.permit(
      tmpAccount.address,
      minter.address,
      100,
      ethers.constants.MaxUint256,
      splitSig.v,
      splitSig.r,
      splitSig.s
    );
    expect(await token.allowance(tmpAccount.address, minter.address)).to.equal(
      100
    );
  });
});
