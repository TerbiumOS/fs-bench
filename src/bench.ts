import os from 'node:os';

import { runBrowserBenchmarks } from './browser-runner.js';
import type { BenchmarkCase, BenchmarkReport, CliOptions } from './types.js';

const SMALL_CASE_LABEL = 'small';
const LARGE_CASE_LABEL = 'large';

export const DEFAULT_OPTIONS: CliOptions = {
  resultsPath: './results.md',
  backends: ['filer', 'lightningfs', 'tfs'],
  smallSizeBytes: 64 * 1024,
  largeSizeBytes: 8 * 1024 * 1024,
  repetitions: 3,
};

export function buildCases(options: CliOptions): BenchmarkCase[] {
  return [
    { kind: 'write', label: `write 1 ${SMALL_CASE_LABEL}`, fileCount: 1, fileSizeBytes: options.smallSizeBytes },
    { kind: 'write', label: `write 5 ${SMALL_CASE_LABEL}`, fileCount: 5, fileSizeBytes: options.smallSizeBytes },
    { kind: 'write', label: `write 1 ${LARGE_CASE_LABEL}`, fileCount: 1, fileSizeBytes: options.largeSizeBytes },
    { kind: 'write', label: `write 5 ${LARGE_CASE_LABEL}`, fileCount: 5, fileSizeBytes: options.largeSizeBytes },
    { kind: 'read', label: `read 1 ${SMALL_CASE_LABEL}`, fileCount: 1, fileSizeBytes: options.smallSizeBytes },
    { kind: 'read', label: `read 5 ${SMALL_CASE_LABEL}`, fileCount: 5, fileSizeBytes: options.smallSizeBytes },
    { kind: 'read', label: `read 1 ${LARGE_CASE_LABEL}`, fileCount: 1, fileSizeBytes: options.largeSizeBytes },
    { kind: 'read', label: `read 5 ${LARGE_CASE_LABEL}`, fileCount: 5, fileSizeBytes: options.largeSizeBytes },
  ];
}

export async function runBenchmarks(options: CliOptions): Promise<BenchmarkReport> {
  const cases = buildCases(options);
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const browserRun = await runBrowserBenchmarks(options, cases, runId);

  return {
    generatedAt: new Date().toISOString(),
    machine: {
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      memoryGiB: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
      browser: browserRun.browser.userAgent,
      browserPlatform: browserRun.browser.platform,
      browserHardwareConcurrency: browserRun.browser.hardwareConcurrency,
      browserDeviceMemoryGiB: browserRun.browser.deviceMemoryGiB,
    },
    options,
    cases,
    backends: browserRun.backends,
  };
}
