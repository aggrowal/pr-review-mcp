# Publishing to npm

This guide explains how releases are produced, validated, and consumed via `npx`.

## Publishing model

The project is designed so that code merged to `main` is published to npm.

- Workflow: `.github/workflows/publish-npm.yml`
- Trigger: push to `main` (plus manual `workflow_dispatch`)
- Steps: install, test, build, bump patch version, publish, commit updated `package.json` + `package-lock.json`

Package consumers install/run with:

```bash
npx -y aggrowal-pr-review-mcp
```

## Required secrets

Configure in GitHub repository settings:

| Secret | Required | Purpose |
|---|---|---|
| `NPM_TOKEN` | yes | npm publish authorization for `aggrowal-pr-review-mcp`. |
| `RELEASE_GITHUB_TOKEN` | optional | Needed if branch protection blocks version-bump push with default token. |

## Release quality gate

PR validation workflow:

- `.github/workflows/ci.yml` runs `npm test` and `npm run build` on PRs to `main`.

To enforce merge blocking:

1. Open branch protection for `main`.
2. Require status check `CI`.
3. Restrict direct pushes as needed for your team policy.

## Maintainer runbook

Before merge to `main`:

1. Confirm `NPM_TOKEN` is valid and scoped correctly.
2. Confirm `CI` checks are passing.
3. Confirm package metadata in `package.json`:
   - `name`
   - `bin`
   - `files`
   - `mcpName`
   - `engines`
4. Run local validation:

```bash
npm ci
npm test
npm run build
npm pack
```

After merge:

1. Verify workflow completed successfully.
2. Verify new version is on npm.
3. Verify `npx -y aggrowal-pr-review-mcp` resolves.
4. Verify version bump commit includes `[skip ci]`.

## Manual publish fallback

If CI publish is intentionally bypassed:

```bash
npm login
npm ci
npm test
npm run build
npm publish
```

## Registry discoverability (optional)

MCP Registry can expose metadata while npm remains the package source.

1. Keep `mcpName` aligned with repository identity.
2. Initialize registry metadata via `mcp-publisher init`.
3. Publish via `mcp-publisher publish`.

## Troubleshooting

### Publish succeeded but version-bump commit failed

- Check branch protection requirements and token scope.
- Provide `RELEASE_GITHUB_TOKEN` with `contents: write`.

### `npx` fails after successful publish

- Confirm npm package name is `aggrowal-pr-review-mcp`.
- Verify latest version is visible in npm registry.
- Retry with clean cache/session.

### Release loop concern

- Workflow uses `[skip ci]` in bump commit message to avoid publish recursion.

