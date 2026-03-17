import React from 'react';
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
  Typography,
} from '@mui/material';

interface Token {
  name: string;
  symbol: string;
  type: string;
  address: string;
  startingPrice: number;
}

interface Props {
  tokens: Token[];
}

const TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error'> = {
  stock: 'primary',
  etf: 'info',
  commodity: 'warning',
};

export const TokensTable: React.FC<Props> = ({ tokens }) => {
  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Ticker</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Contract Address</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tokens.map((token) => (
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
