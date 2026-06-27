# SeaTable Univer Followup

SeaTable Univer Followup 是一个面向单病区临床随访和类 EDC 场景的 SeaTable + Univer 联动原型。它把 SeaTable 作为结构化数据后端，把 Univer 作为接近 Notion/电子表格的前端编辑层，用 Go 提供 SeaTable 同步 API、静态资源服务和 XLSX 导入工具。

当前定位是私有化、小团队使用的单病区数据采集系统雏形：重点解决表格化录入、主表/子表切换、筛选查找、列分类显示、可恢复备份和写回保护。它还不是完整合规 EDC，暂不覆盖公网安全加固、完整权限体系、审计签名、数据锁定等受监管系统能力。

> 说明：本仓库只保留源码和脱敏模板，不包含真实患者数据、生产密钥、运行数据或备份文件。

## 功能特性

- SeaTable 数据读取：从 SeaTable metadata 和 rows 生成前端可编辑的表格数据。
- Univer 表格界面：用 Univer Sheets 渲染随访数据，支持筛选、排序、查找、列显示控制、刷新和保存联动。
- 账号内表格切换：左上方 base 下拉用于切换账号/workspace 内的 SeaTable 表格。
- 主表/子表切换：下方 raw table 下拉用于在当前 base 内切换主表和子表。
- 双向同步：前端通过 Go API 将编辑结果写回 SeaTable，新增 raw 列会在保存时同步创建到 SeaTable。
- 覆盖保护：保存前校验 SeaTable 远端状态签名，切换、刷新和保存时保护未保存编辑，降低覆盖他人更新的风险。
- 删除保护：raw 表写回默认不把前端缺失行当作删除，避免误删 SeaTable 数据；显式删除能力留作后续完善。
- 本地缓存：按 base 维度缓存前端数据，切换不同 base 时不会共用旧表缓存。
- XLSX 导入：直接解析 OpenXML 格式的 XLSX，不依赖 Excel；支持 dry-run、替换同名表和导入前冷备份。
- 部署模板：提供 Docker Compose 示例，包含 SeaTable、MariaDB、Redis、快照服务和 Univer/Go 服务。
- 备份机制：保存和刷新链路生成热备份，导入工具和 Compose 快照服务生成冷备份。

## 单病区小 EDC 目标检查

本项目当前更适合作为单病区小 EDC 的“数据采集和表格工作台”，核心能力覆盖情况如下：

| 目标能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 类 Notion/表格化录入 | 已实现 | Univer 表格提供电子表格式录入，SeaTable 承担结构化数据存储。 |
| 账号内表格切换 | 已实现 | base 下拉切换账号/workspace 内不同 SeaTable base。 |
| 主表/子表切换 | 已实现 | raw table 下拉切换当前 base 内的主表、药敏表、随访表或其他子表。 |
| 表格筛选、查找、分类列显示 | 已实现 | 接入 Univer filter/sort UI，支持右键快速筛选/清除筛选；列面板按基本信息、临床、病理、组化、分子、影像、药敏和随访分组显示，也支持自定义列组和隐藏列。 |
| 数据回滚可恢复 | 部分实现 | 保存/刷新/导入前有 JSON、workbook、metadata 和 rows 快照，可人工恢复；尚未提供一键回滚 UI。 |
| 备份冷热双份 | 已实现基础版 | 热备份位于 `univer-followup/sync-backups/`，冷备份位于 `univer-followup/cold-backups/` 和 Compose `backups/`。 |
| 写回冲突保护 | 已实现 | `/api/save` 支持 `expected_signature`，远端状态变化时返回冲突。 |
| 审计追踪、权限、锁表、电子签名 | 待完成 | 这些属于完整 EDC/受监管系统能力，本阶段未实现。 |

## 技术栈选取

- Go 1.19 标准库 HTTP：依赖少，适合做私有化部署中的同步 API、静态文件服务、导入 CLI 和备份前置逻辑。
- TypeScript + Vite：前端构建简单，类型检查能覆盖表格 payload、列模型和同步请求。
- Univer 0.25：提供接近 Excel/Notion database 的表格体验，已有筛选、排序、公式、列宽、冻结和多 sheet 能力。
- SeaTable Developer：负责 base、table、row、column 等结构化数据存储，适合快速搭出临床随访数据表。
- MariaDB + Redis：沿用 SeaTable 官方服务依赖，MariaDB 存储核心数据，Redis 支撑服务缓存和队列类能力。
- Docker Compose：用于单机私有化运行 SeaTable、数据库、Redis、快照服务和本项目 Go/Univer 服务。

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
    ├── src                       # Univer 前端源码、列模型、工作簿构建和同步转换逻辑
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
5. 对 raw SeaTable 表保存时，只写回发生变化的表；新增列会先创建，缺失行不会自动删除。

### 备份与恢复

项目当前提供两层备份：

- 热备份：刷新、保存和同步写回前会在 `univer-followup/sync-backups/` 写入本地 payload、workbook 或 SeaTable 远端快照，用于找回最近一次操作前的数据状态。
- 冷备份：`import-xlsx` 在替换/导入表格前写入 `univer-followup/cold-backups/`；Docker Compose 的 snapshotter 会把 MariaDB dump 和 SeaTable shared 目录打包到 `backups/`。

恢复方式目前是人工恢复：可以根据 manifest、metadata、rows JSON、数据库 dump 或 shared tar 包回灌到 SeaTable/数据库。还没有一键选择版本并回滚的前端 UI。

### 已实现功能

- SeaTable base 列表加载和账号内 base 切换。
- 当前 base 内主表/子表切换。
- SeaTable raw 表导入、刷新、保存和新增列同步。
- Univer 表格筛选、排序、查找、快速筛选菜单、列隐藏和自定义列组。
- 按临床字段分组的列面板，以及药敏摘要/明细显示。
- 保存前远端签名冲突检测、未保存编辑切换保护和自动保存保护。
- 按 base 隔离的前端缓存。
- 写回前热备份、导入前冷备份和 Compose 周期快照。
- 前端 `sheet.ts` 已拆出列模型、base 模型、raw payload、工作簿构建、snapshot 解析和保存转换模块，降低后续维护成本。

### 待完成功能

- 一键回滚 UI：从热备份/冷备份中选择版本并恢复。
- 显式行删除 UI：把删除动作与普通空行/筛选隐藏区分开，避免误删。
- 更完整的数据校验：字段类型、必填项、范围、访视窗口、跨表一致性和 query 管理。
- EDC 审计能力：操作日志、变更原因、数据锁定、电子签名和角色权限。
- 表结构模板化：按单病区方案快速创建主表、子表、字段和视图。
- 自动化浏览器回归测试：覆盖 base 切换、主表/子表切换、筛选、保存、冲突和恢复流程。

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
