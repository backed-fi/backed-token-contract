import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Chip,
  IconButton,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { WalletType, detectWallets } from '../hooks/useWallet';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (wallet: WalletType) => void;
}

const WALLETS: { id: WalletType; label: string; icon: string }[] = [
  {
    id: 'metamask',
    label: 'MetaMask',
    icon: 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg',
  },
  {
    id: 'phantom',
    label: 'Phantom',
    icon: 'https://phantom.app/img/phantom-logo.png',
  },
];

export const WalletPickerDialog: React.FC<Props> = ({ open, onClose, onSelect }) => {
  const available = detectWallets();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Connect Wallet
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pb: 2 }}>
        <List disablePadding>
          {WALLETS.map(({ id, label, icon }) => {
            const installed = available.includes(id);
            return (
              <ListItemButton
                key={id}
                disabled={!installed}
                onClick={() => { onSelect(id); onClose(); }}
                sx={{ borderRadius: 1, mb: 1, border: '1px solid', borderColor: 'divider' }}
              >
                <ListItemAvatar>
                  <Avatar src={icon} alt={label} sx={{ width: 36, height: 36, bgcolor: 'transparent' }} />
                </ListItemAvatar>
                <ListItemText primary={label} />
                {!installed && (
                  <Chip label="Not installed" size="small" variant="outlined" color="default" />
                )}
              </ListItemButton>
            );
          })}
        </List>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
          Only Sepolia testnet is supported.
        </Typography>
      </DialogContent>
    </Dialog>
  );
};
