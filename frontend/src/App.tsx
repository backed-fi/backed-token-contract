import React, { useMemo } from 'react';
import {
  createTheme,
  ThemeProvider,
  CssBaseline,
  Container,
  Box,
  Typography,
  Button,
} from '@mui/material';
import '@fontsource/inter';
import { TokensTable } from './components/TokensTable';
import { useTokenPrices } from './hooks/useTokenPrices';
import { useWallet } from './hooks/useWallet';
import tokens from '../../scripts/config/sepolia-tokens.json';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#0e0f11',
      paper: '#16181d',
    },
    primary: {
      main: '#7c6af7',
    },
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
});

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function App() {
  const oracleAddresses = useMemo(() => tokens.map((t) => t.oracleAddress), []);
  const prices = useTokenPrices(oracleAddresses);
  const { account, signer, isConnecting, connect, disconnect } = useWallet();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 4 }}>
          <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
              Hackathon Tokens
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Deployed on Sepolia testnet &mdash; {tokens.length} tokens &mdash; prices refresh every 30s
            </Typography>
          </Box>
          {account ? (
            <Button variant="outlined" onClick={disconnect} sx={{ mt: 0.5 }}>
              {shortAddress(account)}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={connect}
              disabled={isConnecting}
              sx={{ mt: 0.5 }}
            >
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </Button>
          )}
        </Box>
        <TokensTable tokens={tokens} prices={prices} account={account} signer={signer} />
      </Container>
    </ThemeProvider>
  );
}
