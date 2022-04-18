import { Signer } from "ethers";
import { ethers } from "hardhat";

// eslint-disable-next-line node/no-missing-import
import { BackedTokenImplementationV2 } from "../../typechain";

export type SignerWithAddress = {
  signer: Signer;
  address: string;
};

export const getSigner = async (index: number): Promise<SignerWithAddress> => {
  const accounts = await ethers.getSigners();

  return {
    signer: accounts[index],
    address: await accounts[index].getAddress(),
  };
};

export const setMintingAllowance = async (
  contract: BackedTokenImplementationV2,
  amount: number
) => {
  await contract.setMintAllowance(amount);
  await (contract.provider as any).send("evm_increaseTime", [
    24 * 60 * 60 + 10,
  ]);
};
