import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export type BalanceMap = Record<string, string | null>;

export function useTokenBalances(account: string | null, tokenAddresses: string[]): BalanceMap {
  const [balances, setBalances] = useState<BalanceMap>({});

  useEffect(() => {
    if (!account) {
      setBalances({});
      return;
    }

    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

    async function fetchBalances() {
      const results = await Promise.allSettled(
        tokenAddresses.map(async (addr) => {
          const contract = new ethers.Contract(addr, ERC20_ABI, provider);
          const [balance, decimals]: [bigint, number] = await Promise.all([
            contract.balanceOf(account),
            contract.decimals(),
          ]);
          return ethers.formatUnits(balance, decimals);
        })
      );

      const updated: BalanceMap = {};
      tokenAddresses.forEach((addr, i) => {
        const result = results[i];
        updated[addr] = result.status === 'fulfilled' ? result.value : null;
      });
      setBalances(updated);
    }

    fetchBalances();
    const interval = setInterval(fetchBalances, 30_000);
    return () => clearInterval(interval);
  }, [account, tokenAddresses.join(',')]);

  return balances;
}
