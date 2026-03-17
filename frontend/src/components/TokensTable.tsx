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
  Skeleton,
  Typography,
} from '@mui/material';
import { PriceMap } from '../hooks/useTokenPrices';

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
}

const TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error'> = {
  stock: 'primary',
  etf: 'info',
  commodity: 'warning',
};

export const TokensTable: React.FC<Props> = ({ tokens, prices }) => {
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
