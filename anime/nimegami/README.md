# nimegami-scraper

Node.js scraper untuk **nimegami.id** — anime subtitle Indonesia (streaming & download).

## Install

```bash
npm install
```

## CLI

```bash
node scraper.js home                          # homepage (anime terbaru)
node scraper.js detail "https://nimegami.id/girls-panzer-motto-love-love-sakusen-desu-sub-indo/"
node scraper.js episode "https://nimegami.id/girls-panzer-motto-love-love-sakusen-desu-sub-indo/"    # streaming/download links episode 1
```

Output JSON.

## Fitur

- Homepage: daftar anime terbaru (title, thumbnail, episode info)
- Detail: sinopsis, studio, genre, status, type, daftar episode
- Episode: link download & streaming (jika ada)

## Test

```bash
npm test
```