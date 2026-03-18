# ── Multiplier Keeper ─────────────────────────────────────────────────────────
# Runs as a Cloud Run Job triggered by Cloud Scheduler every 2 hours.
# Uses its own minimal package.json (only ethers + ts-node) to avoid pulling
# in the repo's heavy hardhat/ganache dev dependencies.

FROM node:22-alpine

WORKDIR /app

# Install only the keeper's minimal dependencies
COPY testTokens/multiplierKeeper/package.json ./package.json
RUN npm install

# Copy source and token config
COPY testTokens/multiplierKeeper/index.ts      ./index.ts
COPY testTokens/multiplierKeeper/tsconfig.json ./tsconfig.json
COPY testTokens/config/                        ./config/

CMD ["node_modules/.bin/ts-node", "--project", "tsconfig.json", "index.ts"]
