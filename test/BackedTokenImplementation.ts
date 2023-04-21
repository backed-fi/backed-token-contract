import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
// eslint-disable-next-line node/no-missing-import
import {
  BackedFactory,
  BackedTokenImplementation,
  SanctionsListMock,
} from "../typechain";

type SignerWithAddress = {
  signer: Signer;
  address: string;
};

describe("BackedToken", function () {
  // General config:
  let tokenFactory: BackedFactory;
  let token: BackedTokenImplementation;
  let sanctionsList: SanctionsListMock;
  let accounts: Signer[];

  // Basic config:
  const tokenName = "Backed Apple";
  const tokenSymbol = "bAAPL";

  // Roles:
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

    // Deploy the Sanctions List contract:
    sanctionsList = await (
      await ethers.getContractFactory("SanctionsListMock", blacklister.signer)
    ).deploy();

    await sanctionsList.deployed();

    // Deploy contract:
    const tokenDeploymentReceipt = await (
      await tokenFactory.deployToken(
        tokenName,
        tokenSymbol,
        owner.address,
        minter.address,
        burner.address,
        pauser.address,
        sanctionsList.address
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

  it("Cannot initialize twice", async function () {
    await expect(
      token.connect(owner.signer).initialize("test1", "test2")
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
