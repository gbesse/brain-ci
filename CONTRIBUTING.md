# Contributing

Brain CI is intentionally a small query adapter protocol plus a differential runner. New integrations should remain separate from the core and demonstrate a realistic question with citations.

Run `npm ci` and `npm run release:check` before opening a pull request. Include an integration test for changes to snapshot handling, adapter parsing, citations, or exit behavior. Do not include private brain pages, transcripts, credentials, or live TypeSafe responses in fixtures.
