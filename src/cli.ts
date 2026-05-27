#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { DEFAULT_OPTIONS, runBenchmarks } from './bench.js';
import { renderMarkdown, writeResultsMarkdown } from './report.js';
import type { BackendName, CliOptions } from './types.js';

function parseSize(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|kib|mb|mib|gb|gib)?$/);

  if (!match) {
    throw new Error(`Invalid size value: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'b';

  if (unit === 'b') {
    return Math.round(amount);
  }

  if (unit === 'kb' || unit === 'kib') {
    return Math.round(amount * 1024);
  }

  if (unit === 'mb' || unit === 'mib') {
    return Math.round(amount * 1024 * 1024);
  }

  return Math.round(amount * 1024 * 1024 * 1024);
}

function parseBackends(value: string): BackendName[] {
  const requested = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const allowed: BackendName[] = ['filer', 'lightningfs', 'tfs'];

  if (requested.length === 0) {
    return DEFAULT_OPTIONS.backends;
  }

  for (const backendName of requested) {
    if (!allowed.includes(backendName as BackendName)) {
      throw new Error(`Unknown backend: ${backendName}`);
    }
  }

  return requested as BackendName[];
}

function printHelp(): void {
  console.log(`fs-bench

Usage:
  fs-bench [options]

Options:
  --results <path>       Output markdown file (default: results.md)
  --small-size <value>   Small file size, e.g. 64kb or 128kib
  --large-size <value>   Large file size, e.g. 8mb or 16mib
  --repetitions <n>      Number of runs per case (default: 3)
  --backends <list>      Comma-separated list of backends
  --help                 Show this message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    ...DEFAULT_OPTIONS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      printHelp();
      process.exit(0);
    }

    if (argument === '--results') {
      options.resultsPath = argv[++index] ?? options.resultsPath;
      continue;
    }

    if (argument === '--small-size') {
      options.smallSizeBytes = parseSize(argv[++index] ?? '');
      continue;
    }

    if (argument === '--large-size') {
      options.largeSizeBytes = parseSize(argv[++index] ?? '');
      continue;
    }

    if (argument === '--repetitions') {
      const value = Number(argv[++index] ?? '');

      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--repetitions must be a positive integer');
      }

      options.repetitions = value;
      continue;
    }

    if (argument === '--backends') {
      options.backends = parseBackends(argv[++index] ?? '');
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBenchmarks(options);
  const markdown = renderMarkdown(report);
  const absoluteResultsPath = await writeResultsMarkdown(options.resultsPath, markdown);

  console.log(`Wrote ${absoluteResultsPath}`);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === entryPoint) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
