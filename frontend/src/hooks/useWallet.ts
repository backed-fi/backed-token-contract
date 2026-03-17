import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

const SEPOLIA_CHAIN_ID = '0xaa36a7';

function getEthereumProvider() {
  return (window as any).phantom?.ethereum ?? (window as any).ethereum ?? null;
}

export interface WalletState {
  account: string | null;
  signer: ethers.JsonRpcSigner | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const initFromProvider = useCallback(async (ethereum: unknown) => {
    const provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
    const accounts: string[] = await provider.send('eth_accounts', []);
    if (accounts.length > 0) {
      const s = await provider.getSigner();
      setAccount(accounts[0]);
      setSigner(s);
    }
  }, []);

  useEffect(() => {
    const ethereum = getEthereumProvider();
    if (!ethereum) return;

    initFromProvider(ethereum);

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
        setSigner(null);
      } else {
        const provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
        provider.getSigner().then((s) => {
          setAccount(accounts[0]);
          setSigner(s);
        });
      }
    };

    const handleChainChanged = () => {
      initFromProvider(ethereum);
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);
    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [initFromProvider]);

  const connect = useCallback(async () => {
    const ethereum = getEthereumProvider();
    if (!ethereum) {
      alert('No EVM wallet detected. Please install Phantom or MetaMask.');
      return;
    }
    setIsConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
      await provider.send('eth_requestAccounts', []);

      // Switch to Sepolia if needed
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(11155111)) {
        try {
          await provider.send('wallet_switchEthereumChain', [{ chainId: SEPOLIA_CHAIN_ID }]);
        } catch {
          // If switch fails, continue anyway
        }
      }

      const s = await provider.getSigner();
      setAccount(await s.getAddress());
      setSigner(s);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
  }, []);

  return { account, signer, isConnecting, connect, disconnect };
}
