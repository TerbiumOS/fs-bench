import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BenchmarkReport, CaseOutcome } from './types.js';

function formatCell(outcome: CaseOutcome): string {
  if (outcome.status === 'ok' && typeof outcome.mbPerSec === 'number') {
    return `${outcome.mbPerSec.toFixed(2)} MB/s`;
  }

  if (outcome.status === 'na') {
    return 'N/A';
  }

  return 'DNF';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
  }

  return `${Math.round(bytes / 1024)} KiB`;
}

function renderSectionTitle(title: string): string {
  return `## ${title}`;
}

export function renderMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  const writeCases = report.cases.filter((benchmarkCase) => benchmarkCase.kind === 'write');
  const readCases = report.cases.filter((benchmarkCase) => benchmarkCase.kind === 'read');

  lines.push('# fs-bench Results');
  lines.push('');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push(renderSectionTitle('Machine'));
  lines.push('');
  lines.push(`- Platform: ${report.machine.platform}`);
  lines.push(`- Architecture: ${report.machine.arch}`);
  lines.push(`- Node: ${report.machine.node}`);
  lines.push(`- CPU: ${report.machine.cpu}`);
  lines.push(`- Cores: ${report.machine.cores}`);
  lines.push(`- Memory: ${report.machine.memoryGiB} GiB`);
  if (report.machine.browser) {
    lines.push(`- Browser: ${report.machine.browser}`);
  }

  if (report.machine.browserPlatform) {
    lines.push(`- Browser platform: ${report.machine.browserPlatform}`);
  }

  if (typeof report.machine.browserHardwareConcurrency === 'number') {
    lines.push(`- Browser hardware concurrency: ${report.machine.browserHardwareConcurrency}`);
  }

  if (typeof report.machine.browserDeviceMemoryGiB === 'number') {
    lines.push(`- Browser device memory: ${report.machine.browserDeviceMemoryGiB} GiB`);
  }

  lines.push('');
  lines.push(renderSectionTitle('Benchmark Settings'));
  lines.push('');
  lines.push(`- Backends: ${report.options.backends.join(', ')}`);
  lines.push(`- Small file size: ${formatBytes(report.options.smallSizeBytes)}`);
  lines.push(`- Large file size: ${formatBytes(report.options.largeSizeBytes)}`);
  lines.push(`- Repetitions: ${report.options.repetitions}`);
  lines.push('');

  const renderTable = (title: string, benchmarkCases: typeof report.cases) => {
    lines.push(renderSectionTitle(title));
    lines.push('');

    const header = ['Backend', ...benchmarkCases.map((benchmarkCase) => benchmarkCase.label)];
    const separator = header.map(() => '---');

    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${separator.join(' | ')} |`);

    for (const backend of report.backends) {
      const cells = benchmarkCases.map((benchmarkCase) => {
        if (!backend.available) {
          return 'N/A';
        }

        return formatCell(backend.results[benchmarkCase.label] ?? { status: 'dnf' });
      });

      lines.push(`| ${backend.displayName} | ${cells.join(' | ')} |`);
    }

    lines.push('');
  };

  const renderCompatibilityTable = () => {
    lines.push(renderSectionTitle('Compatibility'));
    lines.push('');

    const header = ['Backend', 'fs', 'promises (fs.promises)', 'shell'];
    const separator = header.map(() => '---');

    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${separator.join(' | ')} |`);

    for (const backend of report.backends) {
      if (!backend.available) {
        lines.push(`| ${backend.displayName} | N/A | N/A | N/A |`);
        continue;
      }
      
      const fsCap = backend.capabilities.fs ? '✅' : '❌';
      const promisesCap = backend.capabilities.promises ? '✅' : '❌';
      const shellCap = backend.capabilities.shell ? '✅' : '❌';
      
      lines.push(`| ${backend.displayName} | ${fsCap} | ${promisesCap} | ${shellCap} |`);
    }

    lines.push('');
  };

  renderCompatibilityTable();
  renderTable('Write Throughput', writeCases);
  renderTable('Read Throughput', readCases);

  const failures = report.backends.filter((backend) => !backend.available && backend.reason);

  if (failures.length > 0) {
    lines.push(renderSectionTitle('Unavailable Backends'));
    lines.push('');

    for (const backend of failures) {
      lines.push(`- ${backend.displayName}: ${backend.reason}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function writeResultsMarkdown(resultsPath: string, markdown: string): Promise<string> {
  const absolutePath = join(process.cwd(), 'results.md');
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, markdown, 'utf8');

  return absolutePath;
}
