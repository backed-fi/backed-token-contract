import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

const SEPOLIA_CHAIN_ID = '0xaa36a7';

export type WalletType = 'metamask' | 'phantom';

// When multiple wallets are installed they each inject into window.ethereum.providers[].
// Phantom also always exposes window.phantom.ethereum as its own namespace.
function findMetaMask(): unknown | null {
  const win = window as any;
  // Multi-wallet: search the providers array first
  const providers: any[] = win.ethereum?.providers ?? [];
  const fromArray = providers.find((p) => p.isMetaMask && !p.isPhantom);
  if (fromArray) return fromArray;
  // Single-wallet fallback: window.ethereum is MetaMask only
  if (win.ethereum?.isMetaMask && !win.ethereum?.isPhantom) return win.ethereum;
  return null;
}

function findPhantom(): unknown | null {
  return (window as any).phantom?.ethereum ?? null;
}

export function detectWallets(): WalletType[] {
  const available: WalletType[] = [];
  if (findPhantom()) available.push('phantom');
  if (findMetaMask()) available.push('metamask');
  return available;
}

function getProvider(wallet: WalletType): unknown | null {
  if (wallet === 'phantom') return findPhantom();
  if (wallet === 'metamask') return findMetaMask();
  return null;
}

export interface WalletState {
  account: string | null;
  signer: ethers.JsonRpcSigner | null;
  isConnecting: boolean;
  connect: (wallet: WalletType) => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeEthereum, setActiveEthereum] = useState<unknown>(null);

  const initFromProvider = useCallback(async (ethereum: unknown) => {
    const provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
    const accounts: string[] = await provider.send('eth_accounts', []);
    if (accounts.length > 0) {
      const s = await provider.getSigner();
      setAccount(accounts[0]);
      setSigner(s);
    }
  }, []);

  // Re-attach event listeners whenever the active provider changes
  useEffect(() => {
    const ethereum = activeEthereum;
    if (!ethereum) return;

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

    const handleChainChanged = () => initFromProvider(ethereum);

    (ethereum as any).on('accountsChanged', handleAccountsChanged);
    (ethereum as any).on('chainChanged', handleChainChanged);
    return () => {
      (ethereum as any).removeListener('accountsChanged', handleAccountsChanged);
      (ethereum as any).removeListener('chainChanged', handleChainChanged);
    };
  }, [activeEthereum, initFromProvider]);

  const connect = useCallback(async (wallet: WalletType) => {
    const ethereum = getProvider(wallet);
    if (!ethereum) {
      alert(`${wallet === 'phantom' ? 'Phantom' : 'MetaMask'} not detected. Please install the extension.`);
      return;
    }
    setIsConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
      await provider.send('eth_requestAccounts', []);

      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(11155111)) {
        try {
          await provider.send('wallet_switchEthereumChain', [{ chainId: SEPOLIA_CHAIN_ID }]);
        } catch {
          // continue even if switch fails
        }
      }

      const s = await provider.getSigner();
      setAccount(await s.getAddress());
      setSigner(s);
      setActiveEthereum(ethereum);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
    setActiveEthereum(null);
  }, []);

  return { account, signer, isConnecting, connect, disconnect };
}
