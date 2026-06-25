import { ethers } from "hardhat";
import fs from "fs";

async function main() {
    const PROXY_ADMIN = process.env.PROXY_ADMIN!;
    const TOKEN_PROXY = process.env.TOKEN_PROXY!;

    type RawUpdate = { previousMultiplier: string; newMultiplier: string; activationTime: number };
    const pastUpdates: RawUpdate[] = JSON.parse(fs.readFileSync(process.env.PAST_UPDATES_FILE!, "utf8"));

    const v4Impl = await (
        await ethers.getContractFactory("BackedAutoFeeTokenImplementation")
    ).deploy();
    await v4Impl.deployed();

    const proxyAdmin = await ethers.getContractAt("ProxyAdmin", PROXY_ADMIN);

    const tx = await proxyAdmin.upgradeAndCall(
        TOKEN_PROXY,
        v4Impl.address,
        v4Impl.interface.encodeFunctionData("initialize_v4", [pastUpdates])
    );
    const receipt = await tx.wait();
    console.log(`Upgrade + initialize_v4 mined in block ${receipt.blockNumber} (tx: ${tx.hash})`);
}

main().catch((e) => { console.error(e); process.exit(1); });