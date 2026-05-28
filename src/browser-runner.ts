import type { Browser } from 'puppeteer';
import * as puppeteer from 'puppeteer';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { BACKEND_DISPLAY_NAMES, BROWSER_BACKEND_BUNDLES } from './backends.js';
import type {
  BackendName,
  BackendOutcome,
  BenchmarkCase,
  BenchmarkReport,
  CaseOutcome,
  CliOptions,
} from './types.js';

export interface BrowserBenchmarkRun {
  backends: BackendOutcome[];
  browser: {
    userAgent?: string | undefined;
    platform?: string | undefined;
    hardwareConcurrency?: number | undefined;
    deviceMemoryGiB?: number | undefined;
    reason?: string | undefined;
  };
}

function buildBackendOutcome(backendName: BackendName, available: boolean, reason?: string): BackendOutcome {
  const outcome: BackendOutcome = {
    name: backendName,
    displayName: BACKEND_DISPLAY_NAMES[backendName],
    available,
    capabilities: {
      readFile: available,
      writeFile: available,
    },
    results: {},
  };

  if (reason) {
    outcome.reason = reason;
  }

  return outcome;
}

function buildUnavailableRun(selectedBackends: BackendName[], reason: string): BrowserBenchmarkRun {
  const shortReason = reason.split('\n')[0];

  return {
    browser: {
      reason: shortReason,
    },
    backends: selectedBackends.map((backendName) => {
      const backendOutcome = buildBackendOutcome(backendName, false, shortReason);

      return backendOutcome;
    }),
  };
}

function toBrowserCase(benchmarkCase: BenchmarkCase): BenchmarkCase {
  return {
    kind: benchmarkCase.kind,
    label: benchmarkCase.label,
    fileCount: benchmarkCase.fileCount,
    fileSizeBytes: benchmarkCase.fileSizeBytes,
  };
}

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
}

async function startServer(): Promise<{ server: Server; url: string }> {
  const app = express();
  
  for (const [name, path] of Object.entries(BROWSER_BACKEND_BUNDLES)) {
    app.get(`/bundles/${name}.js`, (req, res) => {
      res.sendFile(path);
    });
  }

  app.get('/', (req, res) => {
    res.send('<!doctype html><html><body></body></html>');
  });

  const server = createServer(app);
  
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function loadBrowserBundles(page: import('puppeteer').Page, selectedBackends: BackendName[], serverUrl: string): Promise<void> {
  for (const backendName of selectedBackends) {
    await page.addScriptTag({ url: `${serverUrl}/bundles/${backendName}.js` });
  }
}

export async function runBrowserBenchmarks(
  options: CliOptions,
  cases: BenchmarkCase[],
  runId: string,
): Promise<BrowserBenchmarkRun> {
  const selectedBackends = options.backends;
  let browser: Browser | null = null;
  let serverInstance: Server | null = null;
  let serverUrl = '';

  try {
    const serverSetup = await startServer();
    serverInstance = serverSetup.server;
    serverUrl = serverSetup.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildUnavailableRun(selectedBackends, `Could not start local server: ${message}`);
  }

  try {
    browser = await launchBrowser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (serverInstance) serverInstance.close();
    return buildUnavailableRun(selectedBackends, `Puppeteer could not launch Chromium: ${message}`);
  }

  try {
    const page = await browser.newPage();

    try {
      await page.goto(serverUrl);
      await page.addScriptTag({ content: 'window.__name = function(target, value) { Object.defineProperty(target, "name", { value, configurable: true }); return target; };' });
      await loadBrowserBundles(page, selectedBackends, serverUrl);

      const browserResult = await page.evaluate(
        async ({ selectedBackends: names, cases: benchmarkCases, repetitions, runId: browserRunId }) => {
          const globalScope = globalThis as any;
          const textEncoder = new TextEncoder();

          const createPayload = (label: string, sizeBytes: number): Uint8Array => {
            const payload = new Uint8Array(sizeBytes);
            const seed = textEncoder.encode(label);

            for (let index = 0; index < payload.length; index += 1) {
              const seedByte = seed[index % seed.length] ?? 0;
              payload[index] = seedByte ^ (index & 0xff);
            }

            return payload;
          };

          const createFixturePaths = (backendName: BackendName, benchmarkCase: BenchmarkCase, repetitionIndex: number): string[] => {
            return Array.from({ length: benchmarkCase.fileCount }, (_, fileIndex) => {
              const suffix = `${benchmarkCase.kind}-${benchmarkCase.fileSizeBytes}-${benchmarkCase.fileCount}-${repetitionIndex}-${fileIndex}`;
              return `/${backendName}-${browserRunId}-${suffix}.bin`;
            });
          };

          const calculateThroughput = (bytes: number, elapsedMs: number): number => {
            return bytes / (elapsedMs / 1000) / 1_000_000;
          };

          const mean = (values: number[]): number => {
            return values.reduce((total, value) => total + value, 0) / values.length;
          };

          const createFilerBackend = (name: string): Promise<any> => {
            return new Promise((resolve, reject) => {
              const filerGlobal = globalScope.Filer;

              if (!filerGlobal?.FileSystem) {
                reject(new Error('Filer browser bundle is not available'));
                return;
              }

              const fsInstance = new filerGlobal.FileSystem(
                {
                  name,
                  provider: new filerGlobal.FileSystem.providers.Memory(name),
                },
                (error: unknown) => {
                  if (error) {
                    reject(error);
                    return;
                  }

                  resolve(fsInstance);
                },
              );
            });
          };

          const createLightningBackend = (name: string): any => {
            const lightningGlobal = globalScope.LightningFS;

            if (typeof lightningGlobal !== 'function') {
              throw new Error('LightningFS browser bundle is not available');
            }

            return new lightningGlobal(name, { wipe: true });
          };

          const createTfsBackend = async (name: string): Promise<any> => {
            const tfsGlobal = globalScope.tfs;

            if (!tfsGlobal) {
              throw new Error('TFS browser bundle is not available');
            }

            if (!globalScope.navigator?.storage?.getDirectory) {
              throw new Error('TFS requires the File System Access API');
            }

            const rootHandle = await globalScope.navigator.storage.getDirectory();
            const backendHandle = await rootHandle.getDirectoryHandle(name, { create: true });

            return new tfsGlobal(backendHandle);
          };

          const createBackend = async (backendName: BackendName): Promise<{ name: BackendName; displayName: string; available: boolean; reason?: string; fs?: any }> => {
            const displayName = backendName === 'filer' ? 'Filer' : backendName === 'lightningfs' ? 'LightningFS' : 'TFS';

            try {
              if (backendName === 'filer') {
                const fs = await createFilerBackend(`fs-bench-${browserRunId}-filer`);
                return { name: backendName, displayName, available: true, fs };
              }

              if (backendName === 'lightningfs') {
                const fs = createLightningBackend(`fs-bench-${browserRunId}-lightningfs`);
                return { name: backendName, displayName, available: true, fs };
              }

              const fs = await createTfsBackend(`fs-bench-${browserRunId}-tfs`);
              return { name: backendName, displayName, available: true, fs };
            } catch (error) {
              return {
                name: backendName,
                displayName,
                available: false,
                reason: error instanceof Error ? error.message : String(error),
              };
            }
          };

          const measureOnce = async (
            fsRaw: any,
            backendName: BackendName,
            benchmarkCase: BenchmarkCase,
            repetitionIndex: number,
            payload: Uint8Array,
            paths: string[],
          ): Promise<CaseOutcome> => {
            // Normalize the fs object to find promises
            let promisesApi = fsRaw?.promises;
            if (backendName === 'tfs' && fsRaw?.fs?.promises) {
              promisesApi = fsRaw.fs.promises;
            } else if (backendName === 'tfs' && fsRaw?.promises) {
              promisesApi = fsRaw.promises;
            }

            const writeFile = promisesApi?.writeFile;
            const readFile = promisesApi?.readFile;
            let start = 0;

            try {
              if (benchmarkCase.kind === 'read') {
                if (!writeFile || !readFile) {
                  return { status: 'na' };
                }

                for (const path of paths) {
                  await writeFile(path, payload);
                }
              } else if (!writeFile) {
                return { status: 'na' };
              }

              start = performance.now();

              if (benchmarkCase.kind === 'write') {
                for (const path of paths) {
                  await writeFile(path, payload);
                }
              } else {
                if (!readFile) {
                  return { status: 'na' };
                }

                for (const path of paths) {
                  await readFile(path);
                }
              }
            } catch (error) {
              return {
                status: 'dnf',
                message: error instanceof Error ? error.message : String(error),
              };
            }

            const elapsedMs = performance.now() - start;
            const bytes = benchmarkCase.fileCount * benchmarkCase.fileSizeBytes;

            return {
              status: 'ok',
              mbPerSec: calculateThroughput(bytes, elapsedMs),
            };
          };

          const measureCase = async (
            fs: any,
            backendName: BackendName,
            benchmarkCase: BenchmarkCase,
            repetitionsCount: number,
          ): Promise<CaseOutcome> => {
            const samples: number[] = [];
            let payload: Uint8Array;
            let paths: string[];

            try {
              payload = createPayload(`${backendName}:${benchmarkCase.label}`, benchmarkCase.fileSizeBytes);
              paths = createFixturePaths(backendName, benchmarkCase, 0);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);

              throw new Error(
                `Failed to prepare ${backendName} ${benchmarkCase.label} (${benchmarkCase.fileSizeBytes} bytes): ${message}`,
              );
            }

            for (let repetitionIndex = 0; repetitionIndex < repetitionsCount; repetitionIndex += 1) {
              const result = await measureOnce(fs, backendName, benchmarkCase, repetitionIndex, payload, paths);

              if (result.status !== 'ok' || typeof result.mbPerSec !== 'number') {
                return result;
              }

              samples.push(result.mbPerSec);
            }

            return {
              status: 'ok',
              mbPerSec: mean(samples),
            };
          };

          const backends: BackendOutcome[] = [];

          for (const backendName of names as BackendName[]) {
            const resolvedBackend = await createBackend(backendName);
            
            let promisesApi = resolvedBackend.fs?.promises;
            let callbackApi = resolvedBackend.fs;
            let shellApi = resolvedBackend.fs?.shell;

            if (backendName === 'tfs' && resolvedBackend.fs) {
              promisesApi = resolvedBackend.fs.fs?.promises || resolvedBackend.fs.promises;
              callbackApi = resolvedBackend.fs.fs || resolvedBackend.fs;
              shellApi = resolvedBackend.fs.shell || resolvedBackend.fs.fs?.shell;
            }

            const backendOutcome: BackendOutcome = {
              name: resolvedBackend.name,
              displayName: resolvedBackend.displayName,
              available: resolvedBackend.available,
              capabilities: {
                readFile: Boolean(resolvedBackend.available && promisesApi?.readFile),
                writeFile: Boolean(resolvedBackend.available && promisesApi?.writeFile),
                fs: Boolean(resolvedBackend.available && typeof callbackApi === 'object'),
                promises: Boolean(resolvedBackend.available && typeof promisesApi === 'object'),
                shell: Boolean(resolvedBackend.available && typeof shellApi === 'object'),
              },
              results: {},
            };

            if (!resolvedBackend.available || !resolvedBackend.fs) {
              for (const benchmarkCase of benchmarkCases as BenchmarkCase[]) {
                backendOutcome.results[benchmarkCase.label] = {
                  status: 'na',
                };
              }

              backends.push(backendOutcome);
              continue;
            }

            for (const benchmarkCase of benchmarkCases as BenchmarkCase[]) {
              backendOutcome.results[benchmarkCase.label] = await measureCase(
                resolvedBackend.fs,
                backendName,
                benchmarkCase,
                repetitions,
              );
            }

            backends.push(backendOutcome);
          }

          const browser = globalScope.navigator as {
            userAgent?: string;
            platform?: string;
            hardwareConcurrency?: number;
            deviceMemory?: number;
          };

          return {
            backends,
            browser: {
              userAgent: browser.userAgent,
              platform: browser.platform,
              hardwareConcurrency: browser.hardwareConcurrency,
              deviceMemoryGiB: typeof browser.deviceMemory === 'number' ? browser.deviceMemory : undefined,
            },
          };
        },
        {
          selectedBackends,
          cases: cases.map(toBrowserCase),
          repetitions: options.repetitions,
          runId,
        },
      );

      // Sanitize reasons coming back from the page: truncate long stack traces
      for (const b of browserResult.backends) {
        if (b.reason && typeof b.reason === 'string') {
          b.reason = b.reason.split('\n')[0];
        }
      }

      return {
        backends: browserResult.backends,
        browser: browserResult.browser,
      };
    } finally {
      await page.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return buildUnavailableRun(selectedBackends, `Puppeteer benchmark run failed: ${message}`);
  } finally {
    await browser?.close().catch(() => undefined);
    serverInstance?.close();
  }
}