import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Link,
  Skeleton,
  Typography,
  Button,
  CircularProgress,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { ethers } from 'ethers';
import { PriceMap } from '../hooks/useTokenPrices';

const TOKEN_TAP_ADDRESS = '0xa6cd982a08f3dfc2d8ce2a74e66b6b49efe5ef86';
const TOKEN_TAP_ABI = [
  'function claim(address token)',
  'function cooldownRemaining(address user, address token) view returns (uint256)',
];

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

interface Token {
  name: string;
  symbol: string;
  type: string;
  address: string;
  oracleAddress: string;
}

interface Props {
  tokens: Token[];
  prices: PriceMap;
  account: string | null;
  signer: ethers.JsonRpcSigner | null;
}

const TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error'> = {
  stock: 'primary',
  etf: 'info',
  commodity: 'warning',
};

type ClaimStatus = 'idle' | 'pending' | 'success' | 'error';

interface ClaimButtonProps {
  token: Token;
  signer: ethers.JsonRpcSigner | null;
}

const ClaimButton: React.FC<ClaimButtonProps> = ({ token, signer }) => {
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [cooldown, setCooldown] = useState<number | null>(null); // null = loading
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCooldown = useCallback(async () => {
    if (!signer) return;
    try {
      const tap = new ethers.Contract(TOKEN_TAP_ADDRESS, TOKEN_TAP_ABI, signer);
      const user = await signer.getAddress();
      const remaining: bigint = await tap.cooldownRemaining(user, token.address);
      setCooldown(Number(remaining));
    } catch {
      setCooldown(0);
    }
  }, [signer, token.address]);

  // Fetch on mount and whenever signer changes
  useEffect(() => {
    if (!signer) { setCooldown(null); return; }
    fetchCooldown();
  }, [signer, fetchCooldown]);

  // Tick down every second; re-fetch from chain when it hits 0
  const hasCooldown = cooldown !== null && cooldown > 0;
  useEffect(() => {
    if (!hasCooldown) return;
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(intervalRef.current!);
          fetchCooldown(); // confirm with chain
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current!);
  }, [hasCooldown, fetchCooldown]);

  const handleClaim = async () => {
    if (!signer) return;
    setStatus('pending');
    try {
      const tap = new ethers.Contract(TOKEN_TAP_ADDRESS, TOKEN_TAP_ABI, signer);
      const tx = await tap.claim(token.address);
      await tx.wait();
      setStatus('success');
      fetchCooldown();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg.length > 120 ? msg.slice(0, 120) + '…' : msg);
      setStatus('error');
    }
  };

  if (!signer) {
    return (
      <Tooltip title="Connect wallet to claim">
        <span>
          <Button size="small" variant="outlined" disabled sx={{ minWidth: 80 }}>
            Claim
          </Button>
        </span>
      </Tooltip>
    );
  }

  if (status === 'pending') {
    return (
      <Button size="small" variant="outlined" disabled sx={{ minWidth: 80 }}>
        <CircularProgress size={16} />
      </Button>
    );
  }

  if (status === 'success') {
    return (
      <Button size="small" variant="outlined" color="success" disabled sx={{ minWidth: 80 }}>
        <CheckIcon fontSize="small" />
      </Button>
    );
  }

  if (cooldown === null) {
    return (
      <Button size="small" variant="outlined" disabled sx={{ minWidth: 80 }}>
        <CircularProgress size={16} />
      </Button>
    );
  }

  if (cooldown > 0) {
    return (
      <Tooltip title="Cooldown active — come back later">
        <span>
          <Button size="small" variant="outlined" disabled sx={{ minWidth: 80, fontVariantNumeric: 'tabular-nums' }}>
            {formatCountdown(cooldown)}
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <Button size="small" variant="outlined" onClick={handleClaim} sx={{ minWidth: 80 }}>
        Claim
      </Button>
      <Snackbar
        open={status === 'error'}
        autoHideDuration={6000}
        onClose={() => setStatus('idle')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setStatus('idle')}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </>
  );
};

export const TokensTable: React.FC<Props> = ({ tokens, prices, account, signer }) => {
  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Ticker</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Price</TableCell>
            <TableCell>Contract Address</TableCell>
            <TableCell align="center">Claim</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tokens.map((token) => {
            const price = prices[token.oracleAddress];
            return (
              <TableRow key={token.address} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {token.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                  >
                    {token.symbol}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={token.type}
                    size="small"
                    color={TYPE_COLORS[token.type] ?? 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {!(token.oracleAddress in prices) ? (
                    <Skeleton width={60} />
                  ) : price === null ? (
                    <Typography variant="body2" color="text.disabled">—</Typography>
                  ) : (
                    <Link
                      href={`https://sepolia.etherscan.io/address/${token.oracleAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="hover"
                      sx={{ fontWeight: 500 }}
                    >
                      ${price.toFixed(2)}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`https://sepolia.etherscan.io/address/${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      color: 'text.secondary',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    {token.address}
                  </Link>
                </TableCell>
                <TableCell align="center">
                  <ClaimButton token={token} signer={account ? signer : null} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
