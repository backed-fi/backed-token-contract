/**
 * Extracts a minimal Standard JSON Input for a single contract from the
 * Hardhat build-info file, suitable for manual Etherscan verification.
 *
 * Usage:
 *   npx hardhat run scripts/extractStandardInput.ts
 *
 * Output:
 *   standard-input-<ContractName>.json
 */

import * as fs from "fs";
import * as path from "path";

// ── Configure here ────────────────────────────────────────────────────────────
const TARGET_CONTRACT_FILE =
  "contracts/BackedAutoFeeTokenImplementation.sol";
const OUTPUT_FILE = "standard-input-BackedAutoFeeTokenImplementation.json";
// ─────────────────────────────────────────────────────────────────────────────

function collectImports(
  filePath: string,
  sources: Record<string, { content: string }>,
  visited = new Set<string>()
): Set<string> {
  if (visited.has(filePath)) return visited;
  if (!sources[filePath]) {
    console.warn(`  Warning: source not found for "${filePath}"`);
    return visited;
  }

  visited.add(filePath);
  const content = sources[filePath].content;

  // Match both quoted import forms: import "..." and import '...'
  const importRe = /^\s*import\s+(?:[^"']*?["']([^"']+)["']|["']([^"']+)["'])/gm;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(content)) !== null) {
    const raw = match[1] ?? match[2];

    // Resolve relative paths against the current file's directory
    let resolved: string;
    if (raw.startsWith(".")) {
      resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filePath), raw)
      );
    } else {
      resolved = raw; // e.g. "@openzeppelin/..."
    }

    collectImports(resolved, sources, visited);
  }

  return visited;
}

async function main() {
  const buildInfoDir = path.join("artifacts", "build-info");
  const files = fs.readdirSync(buildInfoDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    throw new Error("No build-info files found. Run `npx hardhat compile` first.");
  }

  // Find the build-info file that contains the target contract
  let buildInfo: any | undefined;
  for (const f of files) {
    const candidate = JSON.parse(
      fs.readFileSync(path.join(buildInfoDir, f), "utf8")
    );
    if (candidate.input?.sources?.[TARGET_CONTRACT_FILE]) {
      buildInfo = candidate;
      console.log(`Using build-info: ${f}`);
      break;
    }
  }

  if (!buildInfo) {
    throw new Error(
      `Target contract "${TARGET_CONTRACT_FILE}" not found in any build-info file.\n` +
        `Run \`npx hardhat compile\` and try again.`
    );
  }

  const allSources: Record<string, { content: string }> = buildInfo.input.sources;

  console.log(`Collecting imports for ${TARGET_CONTRACT_FILE}...`);
  const needed = collectImports(TARGET_CONTRACT_FILE, allSources);
  console.log(`  Found ${needed.size} source files.`);

  const filteredSources: Record<string, { content: string }> = {};
  for (const key of needed) {
    filteredSources[key] = allSources[key];
  }

  // Read evmVersion from compiled metadata so it's explicit in the output
  const compiledMeta =
    buildInfo.output?.contracts?.[TARGET_CONTRACT_FILE]?.[
      path.posix.basename(TARGET_CONTRACT_FILE, ".sol")
    ]?.metadata;
  const evmVersion: string =
    (compiledMeta ? JSON.parse(compiledMeta).settings?.evmVersion : undefined) ??
    "london";

  // Deduplicate outputSelection arrays and inject evmVersion
  const inputSettings = buildInfo.input.settings ?? {};
  const outputSelection: Record<string, Record<string, string[]>> =
    inputSettings.outputSelection ?? {};
  const dedupedOutputSelection: typeof outputSelection = {};
  for (const [file, contracts] of Object.entries(outputSelection)) {
    dedupedOutputSelection[file] = {};
    for (const [contract, outputs] of Object.entries(
      contracts as Record<string, string[]>
    )) {
      dedupedOutputSelection[file][contract] = [...new Set(outputs)];
    }
  }

  const standardInput = {
    ...buildInfo.input,
    settings: {
      ...inputSettings,
      evmVersion,
      outputSelection: dedupedOutputSelection,
    },
    sources: filteredSources,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(standardInput, null, 2));
  console.log(`\nWritten to ${OUTPUT_FILE}`);
  console.log(`  evmVersion: ${evmVersion}`);
  console.log(
    `Upload this file to Etherscan using "Solidity (Standard-Json-Input)" verification.`
  );
  console.log(`Compiler: v${buildInfo.solcVersion}, optimiser runs: 10`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
