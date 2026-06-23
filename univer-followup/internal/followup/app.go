package followup

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type appConfig struct {
	root                    string
	dist                    string
	publicJSON              string
	distJSON                string
	backupDir               string
	xlsxHeadersPath         string
	port                    string
	seatableURL             string
	seatableAdminToken      string
	seatableAccessToken     string
	seatableAccessTokenFile string
	seatableWorkspaceID     string
	seatableBaseName        string
	seatableBaseUUID        string
	seatableTableName       string
	seatableDrugTableName   string
	seatableFollowupName    string
}

type app struct {
	cfg         appConfig
	httpClient  *http.Client
	accessInfo  map[string]any
	tableNames  map[string]string
	xlsxHeaders []string
	mu          sync.Mutex
}

type apiError struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

type saveRequest struct {
	Payload           map[string]any
	Snapshot          any
	ExpectedSignature string
	Force             bool
}

var patientToSeaTable = map[string]string{
	"patient_id":    "patient_id",
	"患者姓名":          "患者姓名",
	"癌种":            "癌种",
	"取样时间":          "取样时间",
	"取样方式":          "取样方式",
	"性别":            "性别",
	"年龄":            "年龄",
	"临床诊断结果":        "临床诊断结果",
	"病理诊断结果":        "病理诊断结果",
	"免疫组化结果":        "免疫组化结果",
	"分子分型":          "分子分型",
	"病程":            "初治/复发",
	"治疗史":           "如复发-->治疗史",
	"术后治疗方案":        "术后治疗方案",
	"疗效评估":          "疗效评估",
	"临床结局":          "临床结局",
	"影像评估":          "影像评估",
	"药敏结果原文":        "药敏结果",
	"取样时间 (年-月-日）":  "取样时间 (年-月-日）",
	"分子分型 （基因检测结果）": "分子分型 （基因检测结果）",
}

func Run() error {
	a := newApp(loadConfig())
	addr := "0.0.0.0:" + a.cfg.port
	log.Printf("followup-go listening on %s", addr)
	return http.ListenAndServe(addr, a.routes())
}

func loadConfig() appConfig {
	root := env("APP_ROOT", "/app")
	return appConfig{
		root:                    root,
		dist:                    filepath.Join(root, "dist"),
		publicJSON:              filepath.Join(root, "public", "followup.json"),
		distJSON:                filepath.Join(root, "dist", "followup.json"),
		backupDir:               filepath.Join(root, "sync-backups"),
		xlsxHeadersPath:         filepath.Join(root, "xlsx_headers.json"),
		port:                    env("PORT", "6809"),
		seatableURL:             env("SEATABLE_URL", "http://seatable:80"),
		seatableAdminToken:      os.Getenv("SEATABLE_ADMIN_TOKEN"),
		seatableAccessToken:     os.Getenv("SEATABLE_ACCESS_TOKEN"),
		seatableAccessTokenFile: os.Getenv("SEATABLE_ACCESS_TOKEN_FILE"),
		seatableWorkspaceID:     env("SEATABLE_WORKSPACE_ID", "1"),
		seatableBaseName:        os.Getenv("SEATABLE_BASE_NAME"),
		seatableBaseUUID:        os.Getenv("SEATABLE_BASE_UUID"),
		seatableTableName:       os.Getenv("SEATABLE_TABLE_NAME"),
		seatableDrugTableName:   os.Getenv("SEATABLE_DRUG_TABLE_NAME"),
		seatableFollowupName:    os.Getenv("SEATABLE_FOLLOWUP_TABLE_NAME"),
	}
}

func newApp(cfg appConfig) *app {
	a := &app{cfg: cfg, httpClient: &http.Client{Timeout: 25 * time.Second}}
	a.xlsxHeaders = readStringSlice(cfg.xlsxHeadersPath)
	return a
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/remote-state", a.handleRemoteState)
	mux.HandleFunc("/api/refresh", a.handleRefresh)
	mux.HandleFunc("/api/save", a.handleSave)
	mux.HandleFunc("/", a.handleStatic)
	return mux
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func readStringSlice(path string) []string {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []string
	if json.Unmarshal(body, &out) != nil {
		return nil
	}
	return out
}

func (a *app) handleRemoteState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{OK: false, Error: "method not allowed"})
		return
	}
	state, err := a.remoteState()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": state})
}

func (a *app) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{OK: false, Error: "method not allowed"})
		return
	}
	payload, err := a.refreshFromSeaTable()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{OK: false, Error: err.Error()})
		return
	}
	counts := map[string]int{
		"patients":  len(asRows(payload["patients"])),
		"drugs":     len(asRows(payload["drug_sensitivity"])),
		"followups": len(asRows(payload["followups"])),
		"tables":    len(asRows(payload["raw_tables"])),
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "payload": payload, "counts": counts})
}

func (a *app) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{OK: false, Error: "method not allowed"})
		return
	}
	req, err := decodeSaveRequest(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{OK: false, Error: err.Error()})
		return
	}
	if conflict, err := a.remoteSignatureConflict(req); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{OK: false, Error: err.Error()})
		return
	} else if conflict != nil {
		writeJSON(w, http.StatusConflict, conflict)
		return
	}
	seatable, err := a.syncToSeaTable(req.Payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{OK: false, Error: err.Error()})
		return
	}
	savedAt, err := a.savePayload(req.Payload, req.Snapshot)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "saved_at": savedAt, "seatable": seatable})
}

func decodeSaveRequest(body io.Reader) (saveRequest, error) {
	var raw map[string]any
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return saveRequest{}, err
	}
	payload, ok := raw["payload"].(map[string]any)
	if !ok {
		return saveRequest{}, errors.New("payload 必须是对象")
	}
	rawMode := len(asAnySlice(payload["changed_raw_tables"])) > 0
	if err := validatePayload(payload, rawMode); err != nil {
		return saveRequest{}, err
	}
	expectedSignature, _ := raw["expected_signature"].(string)
	force, _ := raw["force"].(bool)
	return saveRequest{
		Payload:           payload,
		Snapshot:          raw["snapshot"],
		ExpectedSignature: expectedSignature,
		Force:             force,
	}, nil
}

func (a *app) remoteSignatureConflict(req saveRequest) (map[string]any, error) {
	if req.ExpectedSignature == "" || req.Force {
		return nil, nil
	}
	state, err := a.remoteState()
	if err != nil {
		return nil, err
	}
	currentSignature, _ := state["signature"].(string)
	if currentSignature == "" || currentSignature == req.ExpectedSignature {
		return nil, nil
	}
	return map[string]any{
		"ok":    false,
		"error": "SeaTable 已有新版本，请先从 SeaTable 刷新后再保存，避免覆盖他人修改",
		"state": state,
	}, nil
}

func (a *app) handleStatic(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean("/" + r.URL.Path)
	path := filepath.Join(a.cfg.dist, clean)
	if strings.HasSuffix(r.URL.Path, "/") {
		path = filepath.Join(a.cfg.dist, "index.html")
	}
	if !isSubpath(a.cfg.dist, path) {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(path); err != nil {
		path = a.assetFallback(r.URL.Path, path)
	}
	if stat, err := os.Stat(path); err == nil && !stat.IsDir() {
		a.serveFile(w, r, path, stat)
		return
	}
	http.NotFound(w, r)
}

func (a *app) assetFallback(requestPath, original string) string {
	req := filepath.Clean("/" + requestPath)
	if filepath.Dir(req) != "/assets" {
		return original
	}
	name := filepath.Base(req)
	ext := filepath.Ext(name)
	if ext != ".js" && ext != ".css" {
		return original
	}
	prefix := ""
	for _, candidate := range []string{"index-", "sheet-"} {
		if strings.HasPrefix(name, candidate) {
			prefix = candidate
			break
		}
	}
	if prefix == "" {
		return original
	}
	matches, _ := filepath.Glob(filepath.Join(a.cfg.dist, "assets", prefix+"*"+ext))
	sort.Slice(matches, func(i, j int) bool {
		ai, _ := os.Stat(matches[i])
		aj, _ := os.Stat(matches[j])
		return ai.ModTime().After(aj.ModTime())
	})
	if len(matches) > 0 {
		return matches[0]
	}
	return original
}

func (a *app) serveFile(w http.ResponseWriter, r *http.Request, path string, stat os.FileInfo) {
	ext := filepath.Ext(path)
	ctype := mime.TypeByExtension(ext)
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") && gzipEligible(ext) {
		gz := path + ".gz"
		if gzStat, err := os.Stat(gz); err == nil {
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Vary", "Accept-Encoding")
			w.Header().Set("Content-Length", strconv.FormatInt(gzStat.Size(), 10))
			w.Header().Set("Last-Modified", gzStat.ModTime().UTC().Format(http.TimeFormat))
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, gz)
			return
		}
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Last-Modified", stat.ModTime().UTC().Format(http.TimeFormat))
	http.ServeFile(w, r, path)
}

func gzipEligible(ext string) bool {
	switch ext {
	case ".js", ".css", ".json", ".html":
		return true
	default:
		return false
	}
}

func isSubpath(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, "../")
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	body, _ := json.Marshal(data)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (a *app) configuredAccessToken() string {
	if a.cfg.seatableAccessToken != "" {
		return a.cfg.seatableAccessToken
	}
	if a.cfg.seatableAccessTokenFile != "" {
		body, err := os.ReadFile(a.cfg.seatableAccessTokenFile)
		if err == nil {
			return strings.TrimSpace(string(body))
		}
	}
	return ""
}

func decodeJWTPayload(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		body, err = base64.URLEncoding.DecodeString(parts[1])
	}
	if err != nil {
		return nil
	}
	var out map[string]any
	_ = json.Unmarshal(body, &out)
	return out
}

func (a *app) localBaseName() string {
	for _, path := range []string{a.cfg.publicJSON, a.cfg.distJSON} {
		body, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var data map[string]any
		if json.Unmarshal(body, &data) != nil {
			continue
		}
		source, _ := data["source"].(string)
		if strings.HasPrefix(source, "SeaTable:") {
			name := strings.TrimSpace(strings.TrimPrefix(source, "SeaTable:"))
			if name != "" {
				return name
			}
		}
	}
	return ""
}

func (a *app) resolvedBaseName() string {
	if a.cfg.seatableBaseName != "" {
		return a.cfg.seatableBaseName
	}
	if a.accessInfo != nil {
		if name, _ := a.accessInfo["dtable_name"].(string); name != "" {
			return name
		}
	}
	return a.localBaseName()
}

func (a *app) seatableAccessInfo() (map[string]any, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.accessInfo != nil {
		return a.accessInfo, nil
	}
	token := a.configuredAccessToken()
	if token != "" {
		payload := decodeJWTPayload(token)
		if exp, ok := payload["exp"].(float64); ok && int64(exp) > time.Now().Unix()+60 {
			a.accessInfo = map[string]any{
				"access_token": token,
				"dtable_uuid":  firstString(payload["dtable_uuid"], a.cfg.seatableBaseUUID),
				"dtable_name":  a.resolvedBaseName(),
			}
			return a.accessInfo, nil
		}
	}
	baseName := a.resolvedBaseName()
	if baseName == "" {
		return nil, errors.New("无法确定 SeaTable base 名称，请设置 SEATABLE_BASE_NAME")
	}
	path := fmt.Sprintf("/api/v2.1/workspace/%s/dtable/%s/access-token/", a.cfg.seatableWorkspaceID, url.PathEscape(baseName))
	info, err := a.seatableAPI(path, http.MethodGet, nil, "", false)
	if err != nil {
		return nil, err
	}
	info["dtable_name"] = baseName
	if info["dtable_uuid"] == nil {
		if access, _ := info["access_token"].(string); access != "" {
			payload := decodeJWTPayload(access)
			if uuid, _ := payload["dtable_uuid"].(string); uuid != "" {
				info["dtable_uuid"] = uuid
			}
		}
	}
	a.accessInfo = info
	return info, nil
}

func firstString(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func (a *app) seatableAccessToken() (string, error) {
	info, err := a.seatableAccessInfo()
	if err != nil {
		return "", err
	}
	token, _ := info["access_token"].(string)
	if token == "" {
		return "", errors.New("SeaTable access token 为空")
	}
	return token, nil
}

func (a *app) seatableBaseUUID() (string, error) {
	if a.cfg.seatableBaseUUID != "" {
		return a.cfg.seatableBaseUUID, nil
	}
	info, err := a.seatableAccessInfo()
	if err != nil {
		return "", err
	}
	uuid, _ := info["dtable_uuid"].(string)
	if uuid == "" {
		return "", errors.New("无法确定 SeaTable base UUID，请设置 SEATABLE_BASE_UUID")
	}
	return uuid, nil
}

func (a *app) seatableAPI(path, method string, payload any, token string, dtable bool) (map[string]any, error) {
	authToken := token
	if authToken == "" {
		authToken = a.cfg.seatableAdminToken
	}
	if authToken == "" {
		return nil, errors.New("缺少 SEATABLE_ADMIN_TOKEN 或可用的 base access token")
	}
	base := a.cfg.seatableURL
	if dtable {
		base += "/dtable-server"
	}
	var body io.Reader
	if payload != nil {
		raw, _ := json.Marshal(payload)
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Token "+authToken)
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("SeaTable HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out map[string]any
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (a *app) dtableMetadata(token string) (map[string]any, error) {
	uuid, err := a.seatableBaseUUID()
	if err != nil {
		return nil, err
	}
	out, err := a.seatableAPI("/api/v1/dtables/"+uuid+"/metadata/", http.MethodGet, nil, token, true)
	if err != nil {
		return nil, err
	}
	meta, ok := out["metadata"].(map[string]any)
	if !ok {
		return nil, errors.New("metadata 格式异常")
	}
	return meta, nil
}

func (a *app) targetTableNames(meta map[string]any) map[string]string {
	var names []string
	for _, table := range asRows(meta["tables"]) {
		if name, _ := table["name"].(string); name != "" {
			names = append(names, name)
		}
	}
	baseName := a.resolvedBaseName()
	primary := a.cfg.seatableTableName
	if primary != "" && !contains(names, primary) {
		primary = ""
	}
	if primary == "" && contains(names, baseName) {
		primary = baseName
	}
	if primary == "" && len(names) > 0 {
		primary = names[0]
	}
	var remaining []string
	for _, name := range names {
		if name != primary {
			remaining = append(remaining, name)
		}
	}
	drug := a.cfg.seatableDrugTableName
	if drug != "" && !contains(remaining, drug) {
		drug = ""
	}
	if drug == "" && len(remaining) > 0 {
		drug = remaining[0]
	}
	followup := a.cfg.seatableFollowupName
	if followup != "" && !contains(remaining, followup) {
		followup = ""
	}
	if followup == "" && len(remaining) > 1 {
		followup = remaining[1]
	}
	return map[string]string{"primary": primary, "drug": drug, "followup": followup}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (a *app) gatewayRows(token, tableName string) ([]map[string]any, error) {
	uuid, err := a.seatableBaseUUID()
	if err != nil {
		return nil, err
	}
	rowsURL := fmt.Sprintf("%s/api-gateway/api/v2/dtables/%s/rows/?table_name=%s&limit=10000", a.cfg.seatableURL, uuid, url.QueryEscape(tableName))
	req, _ := http.NewRequest(http.MethodGet, rowsURL, nil)
	req.Header.Set("Authorization", "Token "+token)
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("SeaTable rows HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return asRows(out["rows"]), nil
}

func (a *app) remoteState() (map[string]any, error) {
	token, err := a.seatableAccessToken()
	if err != nil {
		return nil, err
	}
	meta, err := a.dtableMetadata(token)
	if err != nil {
		return nil, err
	}
	var tables []string
	for _, table := range asRows(meta["tables"]) {
		if name, _ := table["name"].(string); name != "" {
			tables = append(tables, name)
		}
	}
	sort.Strings(tables)
	counts := map[string]int{}
	latest := ""
	for _, table := range tables {
		rows, err := a.gatewayRows(token, table)
		if err != nil {
			return nil, err
		}
		counts[table] = len(rows)
		for _, row := range rows {
			mtime := fmt.Sprint(row["_mtime"])
			if mtime > latest {
				latest = mtime
			}
		}
	}
	parts := []string{latest}
	for _, table := range tables {
		parts = append(parts, strconv.Itoa(counts[table]))
	}
	return map[string]any{"latest_mtime": latest, "counts": counts, "signature": strings.Join(parts, "|")}, nil
}

func tableColumnDefs(meta map[string]any, tableName string) []map[string]any {
	for _, table := range asRows(meta["tables"]) {
		if table["name"] == tableName {
			return asRows(table["columns"])
		}
	}
	return nil
}

func tableColumns(meta map[string]any, tableName string) map[string]string {
	out := map[string]string{}
	for _, col := range tableColumnDefs(meta, tableName) {
		name, _ := col["name"].(string)
		key, _ := col["key"].(string)
		if name != "" && key != "" {
			out[name] = key
		}
	}
	return out
}

func readableValue(value any, column map[string]any) string {
	if value == nil {
		return ""
	}
	colType, _ := column["type"].(string)
	if colType == "single-select" || colType == "multiple-select" {
		options := map[string]string{}
		if data, _ := column["data"].(map[string]any); data != nil {
			for _, opt := range asRows(data["options"]) {
				options[fmt.Sprint(opt["id"])] = fmt.Sprint(opt["name"])
			}
		}
		if list, ok := value.([]any); ok {
			var parts []string
			for _, item := range list {
				key := fmt.Sprint(item)
				if options[key] != "" {
					parts = append(parts, options[key])
				} else {
					parts = append(parts, key)
				}
			}
			return strings.Join(parts, "，")
		}
		key := fmt.Sprint(value)
		if options[key] != "" {
			return options[key]
		}
	}
	if list, ok := value.([]any); ok {
		var parts []string
		for _, item := range list {
			parts = append(parts, fmt.Sprint(item))
		}
		return strings.Join(parts, "，")
	}
	if obj, ok := value.(map[string]any); ok {
		raw, _ := json.Marshal(obj)
		return string(raw)
	}
	return fmt.Sprint(value)
}

func (a *app) namedRows(token string, meta map[string]any, tableName string) ([]map[string]any, error) {
	columns := tableColumnDefs(meta, tableName)
	keyToColumn := map[string]map[string]any{}
	for _, col := range columns {
		key, _ := col["key"].(string)
		if key != "" {
			keyToColumn[key] = col
		}
	}
	rawRows, err := a.gatewayRows(token, tableName)
	if err != nil {
		return nil, err
	}
	var rows []map[string]any
	for _, row := range rawRows {
		named := map[string]any{"_id": row["_id"]}
		for key, value := range row {
			if col := keyToColumn[key]; col != nil {
				name, _ := col["name"].(string)
				named[name] = readableValue(value, col)
			}
		}
		rows = append(rows, named)
	}
	return rows, nil
}

func (a *app) upsertRow(token, tableName, rowID string, row map[string]any) error {
	uuid, err := a.seatableBaseUUID()
	if err != nil {
		return err
	}
	method := http.MethodPost
	payload := map[string]any{"table_name": tableName, "row": row}
	if rowID != "" {
		method = http.MethodPut
		payload["row_id"] = rowID
	}
	_, err = a.seatableAPI("/api/v1/dtables/"+uuid+"/rows/", method, payload, token, true)
	return err
}

func compactRow(row map[string]any, columns map[string]string) map[string]any {
	out := map[string]any{}
	for key, value := range row {
		if key == "" || strings.HasPrefix(key, "_") {
			continue
		}
		if _, ok := columns[key]; ok {
			if value == nil {
				out[key] = ""
			} else {
				out[key] = value
			}
		}
	}
	return out
}

func existingRowID(rows map[string]map[string]any, key string) string {
	row, ok := rows[key]
	if !ok || row == nil || row["_id"] == nil {
		return ""
	}
	return fmt.Sprint(row["_id"])
}

func (a *app) snapshotSeaTableState(token string, meta map[string]any) {
	_ = os.MkdirAll(a.cfg.backupDir, 0755)
	names := a.targetTableNames(meta)
	tables := map[string]any{}
	for _, table := range names {
		if table == "" {
			continue
		}
		rows, err := a.namedRows(token, meta, table)
		if err == nil {
			tables[table] = rows
		}
	}
	snapshot := map[string]any{
		"snapshotted_at": time.Now().Format(time.RFC3339),
		"source":         "SeaTable:" + a.resolvedBaseName(),
		"tables":         tables,
	}
	raw, _ := json.MarshalIndent(snapshot, "", "  ")
	_ = atomicWrite(filepath.Join(a.cfg.backupDir, "seatable-"+time.Now().Format("20060102-150405.000000")+".json"), raw)
}

func validatePayload(payload map[string]any, rawMode bool) error {
	if rawMode {
		if asRows(payload["raw_tables"]) == nil {
			return errors.New("payload.raw_tables 必须是数组")
		}
		return nil
	}
	patients := asRows(payload["patients"])
	drugs := asRows(payload["drug_sensitivity"])
	followups := asRows(payload["followups"])
	if patients == nil || drugs == nil || followups == nil {
		return errors.New("payload.patients/drug_sensitivity/followups 必须是数组")
	}
	if len(patients) == 0 {
		return errors.New("拒绝保存空患者列表，避免覆盖现有数据")
	}
	for _, patient := range patients {
		if fmt.Sprint(patient["patient_id"]) == "" {
			return errors.New("患者列表存在空 patient_id")
		}
	}
	for _, f := range followups {
		node := fmt.Sprint(f["随访节点"])
		if node == "Univer保存" || node == "按药物类型" {
			return errors.New("拒绝保存自动派生随访行，请在 SeaTable 随访表维护随访记录")
		}
	}
	return nil
}

func (a *app) syncToSeaTable(payload map[string]any) (map[string]any, error) {
	rawMode := len(asAnySlice(payload["changed_raw_tables"])) > 0
	if err := validatePayload(payload, rawMode); err != nil {
		return nil, err
	}
	token, err := a.seatableAccessToken()
	if err != nil {
		return nil, err
	}
	meta, err := a.dtableMetadata(token)
	if err != nil {
		return nil, err
	}
	names := a.targetTableNames(meta)
	primaryTable := names["primary"]
	drugTable := names["drug"]
	followupTable := names["followup"]
	a.snapshotSeaTableState(token, meta)
	rawTables, rawUpdatedRows, err := a.syncRawTablesToSeaTable(token, meta, payload)
	if err != nil {
		return nil, err
	}
	if rawMode {
		state, _ := a.remoteState()
		return map[string]any{
			"ok":         true,
			"raw_tables": rawTables,
			"raw_rows":   rawUpdatedRows,
			"state":      state,
		}, nil
	}
	patientColumns := tableColumns(meta, primaryTable)
	drugColumns := tableColumns(meta, drugTable)
	followupColumns := tableColumns(meta, followupTable)
	patientKey := patientColumns["patient_id"]
	if patientKey == "" {
		return nil, errors.New("SeaTable 表缺少 patient_id 列")
	}
	rawRows, err := a.gatewayRows(token, primaryTable)
	if err != nil {
		return nil, err
	}
	rows := map[string]map[string]any{}
	for _, row := range rawRows {
		if id := fmt.Sprint(row[patientKey]); id != "" {
			rows[id] = row
		}
	}
	updatedPatients, skippedPatients, skipped := 0, 0, 0
	for _, patient := range asRows(payload["patients"]) {
		patientID := fmt.Sprint(patient["patient_id"])
		rowID := ""
		if row := rows[patientID]; row != nil {
			rowID = fmt.Sprint(row["_id"])
		} else {
			skippedPatients++
		}
		patch := compactRow(patient, patientColumns)
		for source, target := range patientToSeaTable {
			if _, ok := patientColumns[target]; ok {
				if value, exists := patient[source]; exists {
					patch[target] = value
				}
			}
		}
		if len(patch) == 0 {
			skippedPatients++
			continue
		}
		if err := a.upsertRow(token, primaryTable, rowID, patch); err != nil {
			return nil, err
		}
		updatedPatients++
	}
	existingDrugs := map[string]map[string]any{}
	if drugTable != "" {
		rows, _ := a.namedRows(token, meta, drugTable)
		for _, row := range rows {
			key := fmt.Sprint(row["patient_id"]) + "\x00" + fmt.Sprint(row["药物组合"])
			existingDrugs[key] = row
		}
	}
	updatedDrugs := 0
	for _, drug := range asRows(payload["drug_sensitivity"]) {
		if drugTable == "" {
			skipped++
			continue
		}
		patientID := strings.TrimSpace(fmt.Sprint(drug["patient_id"]))
		drugName := strings.TrimSpace(fmt.Sprint(drug["药物组合"]))
		if patientID == "" || drugName == "" {
			skipped++
			continue
		}
		key := patientID + "\x00" + drugName
		rowID := existingRowID(existingDrugs, key)
		patch := compactRow(drug, drugColumns)
		if _, ok := drugColumns["原始值"]; ok && fmt.Sprint(patch["原始值"]) == "" {
			patch["原始值"] = fmt.Sprintf("IC50=%s; 抑制率=%s", patch["IC50"], patch["抑制率"])
		}
		if err := a.upsertRow(token, drugTable, rowID, patch); err != nil {
			return nil, err
		}
		updatedDrugs++
	}
	existingFollowups := map[string]map[string]any{}
	if followupTable != "" {
		rows, _ := a.namedRows(token, meta, followupTable)
		for _, row := range rows {
			key := fmt.Sprint(row["patient_id"]) + "\x00" + fmt.Sprint(row["随访节点"])
			existingFollowups[key] = row
		}
	}
	updatedFollowups := 0
	for _, followup := range asRows(payload["followups"]) {
		if followupTable == "" {
			skipped++
			continue
		}
		key := fmt.Sprint(followup["patient_id"]) + "\x00" + fmt.Sprint(followup["随访节点"])
		if key == "\x00" {
			skipped++
			continue
		}
		rowID := existingRowID(existingFollowups, key)
		patch := compactRow(followup, followupColumns)
		if err := a.upsertRow(token, followupTable, rowID, patch); err != nil {
			return nil, err
		}
		updatedFollowups++
	}
	state, _ := a.remoteState()
	return map[string]any{
		"ok":         true,
		"updated":    updatedPatients,
		"skipped":    skipped + skippedPatients,
		"patients":   updatedPatients,
		"drugs":      updatedDrugs,
		"followups":  updatedFollowups,
		"raw_tables": rawTables,
		"raw_rows":   rawRows,
		"state":      state,
	}, nil
}

func (a *app) syncRawTablesToSeaTable(token string, meta map[string]any, payload map[string]any) (int, int, error) {
	changed := map[string]bool{}
	for _, name := range asAnySlice(payload["changed_raw_tables"]) {
		if s := strings.TrimSpace(fmt.Sprint(name)); s != "" {
			changed[s] = true
		}
	}
	if len(changed) == 0 {
		return 0, 0, nil
	}
	tableExists := map[string]bool{}
	for _, table := range asRows(meta["tables"]) {
		if name, _ := table["name"].(string); name != "" {
			tableExists[name] = true
		}
	}
	updatedTables := 0
	updatedRows := 0
	for _, rawTable := range asRows(payload["raw_tables"]) {
		tableName := strings.TrimSpace(fmt.Sprint(rawTable["name"]))
		if tableName == "" || !changed[tableName] {
			continue
		}
		if !tableExists[tableName] {
			return updatedTables, updatedRows, fmt.Errorf("SeaTable 表不存在: %s", tableName)
		}
		columns := tableColumns(meta, tableName)
		rows := asRows(rawTable["rows"])
		for _, row := range rows {
			rowID := fmt.Sprint(row["_id"])
			patch := compactRow(row, columns)
			if len(patch) == 0 {
				continue
			}
			if err := a.upsertRow(token, tableName, rowID, patch); err != nil {
				return updatedTables, updatedRows, err
			}
			updatedRows++
		}
		updatedTables++
	}
	return updatedTables, updatedRows, nil
}

func (a *app) refreshFromSeaTable() (map[string]any, error) {
	token, err := a.seatableAccessToken()
	if err != nil {
		return nil, err
	}
	meta, err := a.dtableMetadata(token)
	if err != nil {
		return nil, err
	}
	names := a.targetTableNames(meta)
	patients, err := a.namedRows(token, meta, names["primary"])
	if err != nil {
		return nil, err
	}
	drugs := []map[string]any{}
	followups := []map[string]any{}
	if names["drug"] != "" {
		drugs, _ = a.namedRows(token, meta, names["drug"])
	}
	if names["followup"] != "" {
		followups, _ = a.namedRows(token, meta, names["followup"])
	}
	rawTables := []map[string]any{}
	for _, table := range asRows(meta["tables"]) {
		tableName, _ := table["name"].(string)
		if tableName == "" {
			continue
		}
		var columns []string
		for _, column := range tableColumnDefs(meta, tableName) {
			if name, _ := column["name"].(string); name != "" {
				columns = append(columns, name)
			}
		}
		rows, err := a.namedRows(token, meta, tableName)
		if err != nil {
			return nil, err
		}
		sortRows(rows)
		rawTables = append(rawTables, map[string]any{
			"name":    tableName,
			"columns": columns,
			"rows":    rows,
		})
	}
	for _, row := range append(append(patients, drugs...), followups...) {
		delete(row, "_id")
	}
	sortRows(patients)
	sortRows(drugs)
	sortRows(followups)
	payload := map[string]any{
		"generated_at":     time.Now().Format(time.RFC3339),
		"source":           "SeaTable:" + firstNonEmpty(a.resolvedBaseName(), names["primary"]),
		"xlsx_headers":     a.xlsxHeaders,
		"patients":         patients,
		"drug_sensitivity": drugs,
		"followups":        followups,
		"raw_tables":       rawTables,
	}
	_, err = a.savePayload(payload, nil)
	return payload, err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func sortRows(rows []map[string]any) {
	sort.Slice(rows, func(i, j int) bool {
		return sortKey(rows[i]) < sortKey(rows[j])
	})
}

func sortKey(row map[string]any) string {
	source := 0
	if n, err := strconv.Atoi(fmt.Sprint(row["source_row"])); err == nil {
		source = n
	}
	return fmt.Sprintf("%010d|%s|%s|%s", source, row["patient_id"], row["药物组合"], row["随访节点"])
}

func (a *app) savePayload(payload map[string]any, snapshot any) (string, error) {
	if payload["generated_at"] == nil {
		payload["generated_at"] = time.Now().Format(time.RFC3339)
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	if err := atomicWrite(a.cfg.publicJSON, raw); err != nil {
		return "", err
	}
	if err := atomicWrite(a.cfg.distJSON, raw); err != nil {
		return "", err
	}
	if snapshot != nil {
		_ = os.MkdirAll(a.cfg.backupDir, 0755)
		snapRaw, _ := json.MarshalIndent(map[string]any{
			"saved_at": time.Now().Format(time.RFC3339),
			"payload":  payload,
			"snapshot": snapshot,
		}, "", "  ")
		_ = atomicWrite(filepath.Join(a.cfg.backupDir, "univer-"+time.Now().Format("20060102-150405.000000")+".json"), snapRaw)
	}
	return fmt.Sprint(payload["generated_at"]), nil
}

func atomicWrite(path string, body []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0644); err != nil {
		return err
	}
	if gzipEligible(filepath.Ext(path)) {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		_, _ = zw.Write(body)
		_ = zw.Close()
		_ = os.WriteFile(path+".gz", buf.Bytes(), 0644)
	}
	return os.Rename(tmp, path)
}

func asRows(value any) []map[string]any {
	if value == nil {
		return nil
	}
	list, ok := value.([]any)
	if !ok {
		if rows, ok := value.([]map[string]any); ok {
			return rows
		}
		return nil
	}
	rows := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if row, ok := item.(map[string]any); ok {
			rows = append(rows, row)
		}
	}
	return rows
}

func asAnySlice(value any) []any {
	if value == nil {
		return nil
	}
	if list, ok := value.([]any); ok {
		return list
	}
	if list, ok := value.([]string); ok {
		out := make([]any, 0, len(list))
		for _, item := range list {
			out = append(out, item)
		}
		return out
	}
	return nil
}
