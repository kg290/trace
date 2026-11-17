# 🔢 Number Kit (demo fixture)

[← README](../../README.md) · [Check format](../../skills/trace/references/checks.md)

A tiny Node library and CLI for testing TRACE's nonvisual checks.

## 📜 Contract

`total(values)` returns the numeric sum, including zero and negative numbers.

The Node CLI prints the sum followed by a newline. Invalid numeric arguments print `Use finite numbers.` to stderr and exit 2.

## ▶️ Try it

```sh
node cli.mjs 0 -5 2
# -3
node cli.mjs bad
# Use finite numbers.   (stderr, exit 2)
```

The tests check this library and CLI contract with representative inputs, including a seeded off-by-one, an expected error, and an unsupported desktop check. This is a small fixture, not a data-processing benchmark.
