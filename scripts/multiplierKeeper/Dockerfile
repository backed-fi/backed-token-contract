# ── Multiplier Keeper ─────────────────────────────────────────────────────────
# Runs as a Cloud Run Job triggered by Cloud Scheduler every 2 hours.
# Uses its own minimal package.json (only ethers + ts-node) to avoid pulling
# in the repo's heavy hardhat/ganache dev dependencies.

FROM node:22-alpine

WORKDIR /app

# Install only the keeper's minimal dependencies
COPY scripts/multiplierKeeper/package.json ./package.json
RUN npm install

# Copy source and token config
COPY scripts/multiplierKeeper/index.ts      ./index.ts
COPY scripts/multiplierKeeper/tsconfig.json ./tsconfig.json
COPY scripts/config/                        ./config/

CMD ["node_modules/.bin/ts-node", "--project", "tsconfig.json", "index.ts"]
