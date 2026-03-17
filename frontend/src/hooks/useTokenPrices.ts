import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const ORACLE_ABI = ['function latestAnswer() view returns (int256)'];

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export type PriceMap = Record<string, number | null>;

export function useTokenPrices(oracleAddresses: string[]): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});

  useEffect(() => {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

    async function fetchPrices() {
      const results = await Promise.allSettled(
        oracleAddresses.map((addr) =>
          new ethers.Contract(addr, ORACLE_ABI, provider).latestAnswer() as Promise<bigint>
        )
      );

      const updated: PriceMap = {};
      oracleAddresses.forEach((addr, i) => {
        const result = results[i];
        updated[addr] =
          result.status === 'fulfilled' ? Number(result.value) / 1e8 : null;
      });
      setPrices(updated);
    }

    fetchPrices();
    const interval = setInterval(fetchPrices, 30_000);
    return () => clearInterval(interval);
  }, [oracleAddresses.join(',')]);

  return prices;
}
