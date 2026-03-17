import React, { useMemo, useState } from 'react';
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
import { WalletPickerDialog } from './components/WalletPickerDialog';
import { useTokenPrices } from './hooks/useTokenPrices';
import { useTokenBalances } from './hooks/useTokenBalances';
import { useTokenMultipliers } from './hooks/useTokenMultipliers';
import { useWallet, WalletType } from './hooks/useWallet';
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


export default function App() {
  const oracleAddresses = useMemo(() => tokens.map((t) => t.oracleAddress), []);
  const tokenAddresses = useMemo(() => tokens.map((t) => t.address), []);
  const prices = useTokenPrices(oracleAddresses);
  const { account, signer, isConnecting, connect, disconnect } = useWallet();
  const balances = useTokenBalances(account, tokenAddresses);
  const multipliers = useTokenMultipliers(tokenAddresses);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleWalletSelect = (wallet: WalletType) => {
    connect(wallet);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          backgroundImage: 'url(/images/backgrounds/abstract-lines.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center bottom',
          opacity: 0.4,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <Container maxWidth="lg" sx={{ py: 6, position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 4 }}>
          <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
              xStocks Hackathon Tokens
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Deployed on Sepolia testnet &mdash; {tokens.length} tokens &mdash; prices refresh every 30s
            </Typography>
          </Box>
          {account ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Wallet connected
              </Typography>
              <Button variant="outlined" onClick={disconnect}>
                Disconnect
              </Button>
            </Box>
          ) : (
            <Button
              variant="contained"
              onClick={() => setPickerOpen(true)}
              disabled={isConnecting}
              sx={{ mt: 0.5 }}
            >
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </Button>
          )}
        </Box>

        <WalletPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={handleWalletSelect}
        />

        <TokensTable tokens={tokens} prices={prices} balances={balances} multipliers={multipliers} account={account} signer={signer} />
      </Container>
    </ThemeProvider>
  );
}
