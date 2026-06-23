# SeaTable Univer 随访表

这是一个 SeaTable + Univer 的随访表联动原型。

当前实现包含：

- 使用 Docker Compose 桥接网络部署 SeaTable、MariaDB、Redis、快照服务和 Univer 服务。
- 使用 Go HTTP 服务对接 SeaTable，并提供前端静态文件服务。
- 使用 Go 编写 XLSX 导入工具，直接解析 OpenXML，通过 SeaTable HTTP API 建表，并在替换数据前生成冷备份。
- 使用 Univer 前端读取 SeaTable metadata，将 SeaTable 表渲染为 sheet，并通过 Go 服务写回 SeaTable。

## 目录结构

- `compose.example.yaml`：脱敏后的 Compose 模板。
- `.env.example`：环境变量模板。
- `univer-followup/cmd/followup-go`：Go 服务，提供 `/api/refresh`、`/api/save` 和静态文件服务。
- `univer-followup/cmd/import-xlsx`：Go XLSX 导入工具，支持冷备份和同名表替换。
- `univer-followup/src`：Univer 前端源码。

运行数据、患者数据、备份、构建产物和真实密钥不会提交到 git。

## 构建

```bash
cd univer-followup
go build -buildvcs=false -o followup-go ./cmd/followup-go
go build -buildvcs=false -o import-xlsx ./cmd/import-xlsx
npm install
npm run build
```

## 部署

先复制模板：

```bash
cp compose.example.yaml compose.yaml
cp .env.example .env
```

然后在 `compose.yaml` 和 `.env` 中填写真实的 SeaTable 域名、端口、管理员信息、数据库密码和 API token。

启动服务：

```bash
docker compose up -d
```

默认服务分工：

- SeaTable：由 `seatable` 服务提供。
- Univer 前端与 Go API：由 `univer-followup` 服务提供。
- 冷热备份：`snapshotter` 负责数据库和 SeaTable 共享目录的周期快照；XLSX 导入工具负责导入前冷备份。

## 导入 XLSX

把 XLSX 放到 Univer 服务挂载目录内，例如：

```bash
univer-followup/import/clinical-followup.xlsx
```

在 Univer 容器内执行导入：

```bash
docker exec <univer-container> /app/import-xlsx -xlsx /app/import/clinical-followup.xlsx
```

如果需要替换同名 SeaTable 表：

```bash
docker exec <univer-container> /app/import-xlsx -xlsx /app/import/clinical-followup.xlsx -replace-existing
```

导入工具会在修改 SeaTable 前生成冷备份，备份目录位于：

```bash
univer-followup/cold-backups/
```

## 数据同步

前端展示逻辑以 SeaTable 为准：

- SeaTable 中有多少张表，Univer 前端就生成多少个 sheet。
- `/api/refresh` 从 SeaTable 拉取 metadata 和表数据，刷新本地前端数据文件。
- `/api/save` 将前端编辑写回 SeaTable。
- 写回前会进行远端状态签名校验，避免覆盖他人已提交的更新。

## 安全说明

仓库中只保留源码和脱敏模板。以下内容应只保留在部署机器上，不应提交：

- `.env`
- `compose.yaml`
- SeaTable 数据目录
- MariaDB 数据目录
- XLSX 原始文件
- 患者数据 JSON/CSV
- 冷备份和快照备份
- 构建产物和二进制文件
