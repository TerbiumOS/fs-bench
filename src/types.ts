export type BackendName = 'filer' | 'lightningfs' | 'tfs';
export type CaseKind = 'write' | 'read';

export interface CliOptions {
  resultsPath: string;
  backends: BackendName[];
  smallSizeBytes: number;
  largeSizeBytes: number;
  repetitions: number;
}

export interface BenchmarkCase {
  kind: CaseKind;
  label: string;
  fileCount: 1 | 5;
  fileSizeBytes: number;
}

export interface CaseOutcome {
  status: 'ok' | 'na' | 'dnf';
  mbPerSec?: number | undefined;
  message?: string | undefined;
}

export interface BackendOutcome {
  name: BackendName;
  displayName: string;
  available: boolean;
  reason?: string | undefined;
  capabilities: Partial<Record<'readFile' | 'writeFile' | 'fs' | 'promises' | 'shell', boolean>>;
  results: Record<string, CaseOutcome>;
}

export interface BenchmarkReport {
  generatedAt: string;
  machine: {
    platform: string;
    arch: string;
    node: string;
    cpu: string;
    cores: number;
    memoryGiB: number;
    browser?: string | undefined;
    browserPlatform?: string | undefined;
    browserHardwareConcurrency?: number | undefined;
    browserDeviceMemoryGiB?: number | undefined;
  };
  options: CliOptions;
  cases: BenchmarkCase[];
  backends: BackendOutcome[];
}
