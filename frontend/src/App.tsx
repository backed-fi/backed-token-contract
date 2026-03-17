import React from 'react';
import { createTheme, ThemeProvider, CssBaseline, Container, Box, Typography } from '@mui/material';
import '@fontsource/inter';
import { TokensTable } from './components/TokensTable';
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
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Hackathon Tokens
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Deployed on Sepolia testnet &mdash; {tokens.length} tokens
          </Typography>
        </Box>
        <TokensTable tokens={tokens} />
      </Container>
    </ThemeProvider>
  );
}
