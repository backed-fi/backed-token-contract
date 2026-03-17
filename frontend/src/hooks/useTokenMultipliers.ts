import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const TOKEN_ABI = [
  'function getCurrentMultiplier() view returns (uint256 currentMultiplier, uint256 periodsPassed, uint256 currentMultiplierNonce)',
];

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export type MultiplierMap = Record<string, number | null>;

export function useTokenMultipliers(tokenAddresses: string[]): MultiplierMap {
  const [multipliers, setMultipliers] = useState<MultiplierMap>({});

  useEffect(() => {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

    async function fetchMultipliers() {
      const results = await Promise.allSettled(
        tokenAddresses.map(async (addr) => {
          const contract = new ethers.Contract(addr, TOKEN_ABI, provider);
          const { currentMultiplier } = await contract.getCurrentMultiplier();
          return Number(ethers.formatUnits(currentMultiplier, 18));
        })
      );

      const updated: MultiplierMap = {};
      tokenAddresses.forEach((addr, i) => {
        const result = results[i];
        updated[addr] = result.status === 'fulfilled' ? result.value : null;
      });
      setMultipliers(updated);
    }

    fetchMultipliers();
    const interval = setInterval(fetchMultipliers, 30_000);
    return () => clearInterval(interval);
  }, [tokenAddresses.join(',')]);

  return multipliers;
}
