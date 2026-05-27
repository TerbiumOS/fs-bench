# fs-bench
A benchmarking tool for benchmarking web file system implementations

## Usage

Build the CLI and run the default benchmark suite:

```bash
npm run bench
```

You can also run the published binary directly once installed from npm:

```bash
npx @terbiumos/fs-bench --results results.md
```

Available options:

```bash
fs-bench --results results.md --small-size 64kb --large-size 8mb --repetitions 3 --backends filer,lightningfs,tfs
```

&copy; Copyright 2026 TerbiumOS Development

Licensed under the [Apache 2.0 License](./LICENSE)
