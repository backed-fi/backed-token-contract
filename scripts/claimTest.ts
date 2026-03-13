import { ethers } from "hardhat";
import { getEnv } from "./helpers/getEnv";

const NVDA_ADDRESS = "0xE192289dDE12522620AaFb992b3043Cdc6463694";
const tapAddress = getEnv("TOKEN_TAP_ADDRESS");

const claim = async () => {
  const [signer] = await ethers.getSigners();
  console.log(`Claimer: ${signer.address}`);
  console.log(`Tap:     ${tapAddress}`);
  console.log(`Token:   NVDAxcc (${NVDA_ADDRESS})\n`);

  const tap = new ethers.Contract(
    tapAddress,
    ["function claim(address token) external"],
    signer
  );

  const tx = await tap.claim(NVDA_ADDRESS);
  console.log(`Tx hash: ${tx.hash}`);
  await tx.wait();
  console.log(`✅ Claimed 100 NVDAxcc`);
};

claim()
  .then(() => console.log("\n👏 Done"))
  .catch((error) => console.error("🙄 Script errored...", error));
