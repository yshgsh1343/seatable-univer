# SeaTable Univer Follow-Up

This repository contains a SeaTable + Univer follow-up table prototype.

The current implementation uses:

- Docker Compose with a bridge network for SeaTable, MariaDB, Redis, a snapshotter, and the Univer service.
- A Go HTTP service for SeaTable integration and static file serving.
- A Go XLSX import tool that parses OpenXML directly, creates SeaTable tables over HTTP, and creates a cold backup before replacing data.
- A Univer frontend that renders SeaTable metadata as sheets and saves edits back through the Go service.

## Layout

- `compose.example.yaml`: sanitized Compose template.
- `.env.example`: required secret template.
- `univer-followup/cmd/followup-go`: Go service for `/api/refresh`, `/api/save`, and static frontend serving.
- `univer-followup/cmd/import-xlsx`: Go XLSX importer with cold backup and replace mode.
- `univer-followup/src`: Univer frontend source.

Runtime data, patient data, backups, build outputs, and real secrets are intentionally excluded from git.

## Build

```bash
cd univer-followup
go build -buildvcs=false -o followup-go ./cmd/followup-go
go build -buildvcs=false -o import-xlsx ./cmd/import-xlsx
npm install
npm run build
```

## Deploy

```bash
cp compose.example.yaml compose.yaml
cp .env.example .env
```

Fill in real SeaTable credentials and host settings in `compose.yaml` and `.env`, then run:

```bash
docker compose up -d
```

## Import XLSX

Place the XLSX inside the app mount, then run the importer from the Univer container:

```bash
docker exec <univer-container> /app/import-xlsx -xlsx /app/import/clinical-followup.xlsx
```

To replace an existing table with the same name:

```bash
docker exec <univer-container> /app/import-xlsx -xlsx /app/import/clinical-followup.xlsx -replace-existing
```

The importer creates a cold backup under `univer-followup/cold-backups/` before modifying SeaTable.
