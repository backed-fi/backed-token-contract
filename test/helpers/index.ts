import { Signer } from "ethers";
import { ethers } from "hardhat";
import {
  SnapshotRestorer,
  takeSnapshot,
} from "@nomicfoundation/hardhat-network-helpers";
import { AsyncFunc } from "mocha";

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

const SNAPSHOTS: SnapshotRestorer[] = [];

export function cacheBeforeEach(initializer: AsyncFunc): void {
  let initialized = false;

  beforeEach(async function () {
    if (!initialized) {
      await initializer.call(this);
      SNAPSHOTS.push(await takeSnapshot());
      initialized = true;
    } else {
      const snapshotId = SNAPSHOTS.pop()!;
      await snapshotId.restore();
      SNAPSHOTS.push(await takeSnapshot());
    }
  });

  after(async function () {
    if (initialized) {
      const snapshotId = SNAPSHOTS.pop()!;
      await snapshotId.restore();
    }
  });
}
