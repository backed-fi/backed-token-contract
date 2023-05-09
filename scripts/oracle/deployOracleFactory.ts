/* eslint-disable camelcase */
import { ethers } from "hardhat";

import { getEnv } from "../helpers/getEnv";
import { BackedOracleFactory__factory } from "../../typechain";

const proxyAdmin = getEnv("ORACLE_PROXY_ADMIN");
const timelockWorker = getEnv("ORACLE_TIMELOCK_WORKER")

const deployRPC = getEnv("ORACLE_RPC");
const deployPrivateKey = getEnv("ORACLE_PK");

const deployOracleFactory = async () => {
  const provider = new ethers.providers.JsonRpcProvider(deployRPC);
  const signer = new ethers.Wallet(deployPrivateKey, provider);

  const oracleFactory = await new BackedOracleFactory__factory(signer).deploy(
    proxyAdmin,
      [
          timelockWorker
      ]
  );

  console.log(`🌱 Oracle factory deployed to ${oracleFactory.address}`);
};

deployOracleFactory()
  .then(() => console.log("👏 Script successfully executed"))
  .catch((error) => console.error("🙄 Script errored...", error));
