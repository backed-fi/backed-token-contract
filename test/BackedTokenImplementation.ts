import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { BigNumber, Signer } from "ethers";
// eslint-disable-next-line node/no-missing-import
import {
  BackedFactory,
  BackedTokenImplementation,
  BackedTokenImplementationV2,
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedToken", function () {
  // General config:
  let tokenFactory: BackedFactory;
  let token: BackedTokenImplementation;
  let accounts: Signer[];

  // Basic config:
  const tokenName = "Wrapped Apple";
  const tokenSymbol = "WAAPL";

  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let tmpAccount: SignerWithAddress;
  let chainId: BigNumber;

  beforeEach(async () => {
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

    // Deploy the token factory
    tokenFactory = await (
      await ethers.getContractFactory("BackedFactory")
    ).deploy(owner.address);

    await tokenFactory.deployed();

    // Deploy contract:
    const tokenDeploymentReceipt = await (
      await tokenFactory.deployToken(
        tokenName,
        tokenSymbol,
        owner.address,
        minter.address,
        burner.address,
        pauser.address
      )
    ).wait();

    const deployedTokenAddress = tokenDeploymentReceipt.events?.find(
      (event) => event.event === "NewToken"
    )?.args?.newToken;

    token = await ethers.getContractAt(
      "BackedTokenImplementation",
      deployedTokenAddress
    );

    // Chain Id
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

  it("Should not allow address 0 to be set as minter", async () => {
    await expect(
      token.setMinter(ethers.constants.AddressZero)
    ).to.be.revertedWith("BackedToken: address should not be 0");
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

  it("Should not allow address 0 to be set as burner", async () => {
    await expect(
      token.setBurner(ethers.constants.AddressZero)
    ).to.be.revertedWith("BackedToken: address should not be 0");
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

  it("Should not allow address 0 to be set as pauser", async () => {
    await expect(
      token.setPauser(ethers.constants.AddressZero)
    ).to.be.revertedWith("BackedToken: address should not be 0");
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

  it("Define Blacklister and transfer Blacklister", async function () {
    // Set Blacklister
    let receipt = await (
      await token.setBlacklister(blacklister.address)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("NewBlacklister");
    expect(receipt.events?.[0].args?.[0]).to.equal(blacklister.address);
    expect(await token.blacklister()).to.equal(blacklister.address);

    // Change Blacklister
    receipt = await (await token.setBlacklister(tmpAccount.address)).wait();
    expect(receipt.events?.[0].event).to.equal("NewBlacklister");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(await token.blacklister()).to.equal(tmpAccount.address);
  });

  it("Try to define Blacklister from wrong address", async function () {
    await expect(
      token.connect(accounts[3]).setBlacklister(blacklister.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Should not allow address 0 to be set as blacklister", async () => {
    await expect(
      token.setBlacklister(ethers.constants.AddressZero)
    ).to.be.revertedWith("BackedToken: address should not be 0");
  });

  it("Blacklist address", async function () {
    await token.setMinter(minter.address);
    await token.connect(minter.signer).mint(owner.address, 100);
    await token.connect(minter.signer).mint(tmpAccount.address, 100);
    await token.setPauser(pauser.address);
    await token.setBlacklister(blacklister.address);

    // Try to blacklist not from blacklister account:
    await expect(
      token.connect(owner.signer).setBlacklist(tmpAccount.address, true)
    ).to.be.revertedWith("BackedToken: Only blacklister");

    // Blacklist an address:
    const receipt = await (
      await token
        .connect(blacklister.signer)
        .setBlacklist(tmpAccount.address, true)
    ).wait();
    expect(receipt.events?.[0].event).to.equal("BlacklistChange");
    expect(receipt.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt.events?.[0].args?.[1]).to.equal(true);

    // Try to send to the blacklisted address:
    await expect(token.transfer(tmpAccount.address, 100)).to.be.revertedWith(
      "BackedToken: receiver is blacklisted"
    );

    // Try to send from the blacklisted address:
    await expect(
      token.connect(tmpAccount.signer).transfer(owner.address, 100)
    ).to.be.revertedWith("BackedToken: sender is blacklisted");

    // Remove from blacklist:
    const receipt2 = await (
      await token
        .connect(blacklister.signer)
        .setBlacklist(tmpAccount.address, false)
    ).wait();
    expect(receipt2.events?.[0].event).to.equal("BlacklistChange");
    expect(receipt2.events?.[0].args?.[0]).to.equal(tmpAccount.address);
    expect(receipt2.events?.[0].args?.[1]).to.equal(false);

    // Check transfer is possible:
    token.transfer(tmpAccount.address, 100);
    token.connect(tmpAccount.signer).transfer(owner.address, 100);
  });
});
