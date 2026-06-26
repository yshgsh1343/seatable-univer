# SeaTable Univer Followup

SeaTable Univer Followup 是一个面向临床随访数据的 SeaTable + Univer 联动原型。项目用 Go 提供 SeaTable 数据同步 API 和静态资源服务，用 Vite/Univer 提供前端表格编辑界面，并提供 XLSX 导入工具把既有随访表导入 SeaTable。

> 说明：本仓库只保留源码和脱敏模板，不包含真实患者数据、生产密钥、运行数据或备份文件。

## 功能特性

- SeaTable 数据读取：从 SeaTable metadata 和 rows 生成前端可编辑的表格数据。
- Univer 表格界面：用 Univer Sheets 渲染随访数据，支持列显示控制、刷新和保存联动。
- 双向同步：前端通过 Go API 将编辑结果写回 SeaTable。
- 覆盖保护：保存前校验 SeaTable 远端状态签名，降低覆盖他人更新的风险。
- XLSX 导入：直接解析 OpenXML 格式的 XLSX，不依赖 Excel；支持 dry-run、替换同名表和导入前冷备份。
- 部署模板：提供 Docker Compose 示例，包含 SeaTable、MariaDB、Redis、快照服务和 Univer/Go 服务。
- 备份机制：Compose 快照服务周期备份数据库与 SeaTable 共享目录；导入工具在修改 SeaTable 前生成冷备份。

## 技术栈

- 后端：Go 1.19，标准库 HTTP 服务。
- 前端：TypeScript、Vite、Univer 0.25、React 19。
- 数据服务：SeaTable Developer、MariaDB、Redis。
- 部署：Docker Compose。

## 目录结构

```text
.
├── compose.example.yaml          # Docker Compose 脱敏模板
├── .env.example                  # 环境变量模板
├── README.md
└── univer-followup
    ├── cmd
    │   ├── followup-go           # Go HTTP 服务入口
    │   └── import-xlsx           # XLSX 导入工具入口
    ├── internal
    │   ├── followup              # SeaTable 刷新、保存、防覆盖校验和静态文件服务
    │   └── importer              # XLSX 解析、导入计划、冷备份和 SeaTable 表替换
    ├── src                       # Univer 前端源码
    ├── package.json
    ├── package-lock.json
    ├── go.mod
    └── vite.config.ts
```

## 环境要求

- Docker 与 Docker Compose。
- Go 1.19 或更高版本。
- Node.js 与 npm。建议使用能满足 Vite 7 要求的当前 LTS 版本。
- 可访问的 SeaTable 服务，或使用本仓库的 `compose.example.yaml` 启动一套本地服务。

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/yshgsh1343/seatable-univer.git
cd seatable-univer
```

### 2. 准备配置

```bash
cp compose.example.yaml compose.yaml
cp .env.example .env
```

至少需要检查并替换以下配置：

- `compose.yaml` 中的 SeaTable 域名、端口、管理员账号、数据库密码、Redis 密码和 JWT 私钥。
- `.env` 中的 `SEATABLE_ADMIN_TOKEN`。
- `compose.yaml` 或运行环境中的 `SEATABLE_BASE_NAME`、`SEATABLE_WORKSPACE_ID`。

### 3. 构建 Go 服务和前端资源

```bash
cd univer-followup
go build -buildvcs=false -o followup-go ./cmd/followup-go
go build -buildvcs=false -o import-xlsx ./cmd/import-xlsx
npm install
npm run build
cd ..
```

### 4. 启动服务

```bash
docker compose up -d
```

默认端口：

- SeaTable：`http://localhost:6805`
- Univer Followup：`http://localhost:6809`

## 配置说明

### Go 服务环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_ROOT` | `/app` | 应用根目录，容器内默认为 `/app`。 |
| `PORT` | `6809` | Go HTTP 服务监听端口。 |
| `SEATABLE_URL` | `http://seatable:80` | SeaTable 服务地址。 |
| `SEATABLE_ADMIN_TOKEN` | 无 | SeaTable 管理员 API token。未提供 base access token 时需要它换取访问 token。 |
| `SEATABLE_ACCESS_TOKEN` | 无 | SeaTable base access token。 |
| `SEATABLE_ACCESS_TOKEN_FILE` | 无 | 从文件读取 base access token。 |
| `SEATABLE_WORKSPACE_ID` | `1` | SeaTable workspace ID。 |
| `SEATABLE_BASE_NAME` | 无 | 目标 base 名称。 |
| `SEATABLE_BASE_UUID` | 无 | 目标 base UUID。提供后可减少自动解析。 |
| `SEATABLE_TABLE_NAME` | 无 | 主表名。不配置时自动选择。 |
| `SEATABLE_DRUG_TABLE_NAME` | 无 | 药敏表名。不配置时自动选择。 |
| `SEATABLE_FOLLOWUP_TABLE_NAME` | 无 | 随访表名。不配置时自动选择。 |

### 运行时文件

以下路径会在运行或导入过程中生成，不应提交到 git：

- `data/`
- `backups/`
- `univer-followup/dist/`
- `univer-followup/public/followup.json*`
- `univer-followup/sync-backups/`
- `univer-followup/cold-backups/`
- `univer-followup/import/`
- `univer-followup/xlsx_headers.json`
- `univer-followup/followup-go`
- `univer-followup/import-xlsx`
- `univer-followup/node_modules/`

## XLSX 导入

默认导入路径为容器内：

```text
/app/import/clinical-followup.xlsx
```

可以先执行 dry-run，确认工作表名、列数和行数：

```bash
docker exec <univer-container> /app/import-xlsx \
  -xlsx /app/import/clinical-followup.xlsx \
  -dry-run
```

导入新表：

```bash
docker exec <univer-container> /app/import-xlsx \
  -xlsx /app/import/clinical-followup.xlsx
```

替换同名表：

```bash
docker exec <univer-container> /app/import-xlsx \
  -xlsx /app/import/clinical-followup.xlsx \
  -replace-existing
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `-xlsx` | XLSX 文件路径。 |
| `-backup-dir` | 冷备份输出目录，默认 `/app/cold-backups`。 |
| `-seatable-url` | SeaTable 服务地址。 |
| `-admin-token` | SeaTable 管理员 API token。 |
| `-access-token` | SeaTable base access token。 |
| `-workspace-id` | SeaTable workspace ID。 |
| `-base-name` | SeaTable base 名称。 |
| `-base-uuid` | SeaTable base UUID。 |
| `-table-name` | 目标表名；默认使用 XLSX 第一个 sheet 名称。 |
| `-delete-existing` | 删除导入前已存在的其他表，默认开启。 |
| `-replace-existing` | 允许通过临时表替换同名目标表。 |
| `-dry-run` | 只解析 XLSX 并输出摘要，不修改 SeaTable。 |

导入工具会在修改 SeaTable 前生成冷备份，默认位于：

```text
univer-followup/cold-backups/
```

每次冷备份包含 XLSX 原文件副本、metadata、已有表 rows 和 manifest。

## 数据同步

前端以 SeaTable 为数据源：

1. 进入页面后，前端请求 Go 服务读取或刷新本地 `followup.json`。
2. 点击“从 SeaTable 刷新”会调用 `/api/refresh`，从 SeaTable 拉取最新 metadata 和 rows。
3. 点击“保存联动”会调用 `/api/save`，将当前表格数据写回 SeaTable。
4. 保存前会用远端状态签名检测冲突；如果 SeaTable 已有新版本，接口返回 `409 Conflict`。

### HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/remote-state` | 获取 SeaTable 当前状态和签名。 |
| `POST` | `/api/refresh` | 刷新本地前端数据。请求体可传 `{ "force": true }` 强制从 SeaTable 拉取。 |
| `POST` | `/api/save` | 保存前端编辑结果到 SeaTable。支持 `expected_signature` 和 `force`。 |
| `GET` | `/` | 提供构建后的前端静态文件。 |

## 本地开发

启动前端开发服务：

```bash
cd univer-followup
npm install
npm run dev
```

构建前端：

```bash
cd univer-followup
npm run build
```

构建 Go 二进制：

```bash
cd univer-followup
go build -buildvcs=false -o followup-go ./cmd/followup-go
go build -buildvcs=false -o import-xlsx ./cmd/import-xlsx
```

直接运行 Go 服务时，需要提供 SeaTable 相关环境变量：

```bash
cd univer-followup
APP_ROOT="$PWD" \
PORT=6809 \
SEATABLE_URL=http://localhost:6805 \
SEATABLE_ADMIN_TOKEN=<admin-token> \
SEATABLE_BASE_NAME=<base-name> \
./followup-go
```
