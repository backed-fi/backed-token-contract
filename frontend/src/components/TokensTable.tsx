import React, { useState } from 'react';
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
const TOKEN_TAP_ABI = ['function claim(address token)'];

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

  const handleClaim = async () => {
    if (!signer) return;
    setStatus('pending');
    try {
      const tap = new ethers.Contract(TOKEN_TAP_ADDRESS, TOKEN_TAP_ABI, signer);
      const tx = await tap.claim(token.address);
      await tx.wait();
      setStatus('success');
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
          <Button size="small" variant="outlined" disabled>
            Claim
          </Button>
        </span>
      </Tooltip>
    );
  }

  if (status === 'pending') {
    return (
      <Button size="small" variant="outlined" disabled sx={{ minWidth: 72 }}>
        <CircularProgress size={16} />
      </Button>
    );
  }

  if (status === 'success') {
    return (
      <Button size="small" variant="outlined" color="success" disabled sx={{ minWidth: 72 }}>
        <CheckIcon fontSize="small" />
      </Button>
    );
  }

  return (
    <>
      <Button size="small" variant="outlined" onClick={handleClaim} sx={{ minWidth: 72 }}>
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
