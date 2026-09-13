# Codex Analytics Market Scanner v5

Deploy the entire contents of this folder to the root of a GitHub Pages repository.

## Home page
`index.html` is now the scanner selector:
- **Manual Scan** → `/manual/` (V1 workflow)
- **Market Scanner** → `/scanner/` (guided/new workflow)

The Codex logo inside either scanner returns to the selector.

## API key
Both scanners use the same browser-local key: `codex-bq-key`.
The home page asks for a key on first visit before either scanner is used. Direct visits to either scanner also guard against a missing key.

## Deployment
Replace the old repository contents with this package, commit, and allow GitHub Pages to rebuild. A hard refresh is recommended after deployment.
