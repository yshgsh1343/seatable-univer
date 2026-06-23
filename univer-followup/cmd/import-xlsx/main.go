package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type config struct {
	appRoot         string
	xlsxPath        string
	backupRoot      string
	seatableURL     string
	adminToken      string
	accessToken     string
	workspaceID     string
	baseName        string
	baseUUID        string
	tableName       string
	deleteExisting  bool
	dryRun          bool
	replaceExisting bool
}

type parsedWorkbook struct {
	SheetName string
	Headers   []string
	Rows      [][]string
}

type client struct {
	cfg        config
	httpClient *http.Client
}

func main() {
	cfg := readConfig()
	if err := run(cfg); err != nil {
		fmt.Fprintln(os.Stderr, "import failed:", err)
		os.Exit(1)
	}
}

func readConfig() config {
	appRoot := env("APP_ROOT", "/app")
	cfg := config{
		appRoot:        appRoot,
		xlsxPath:       filepath.Join(appRoot, "import", "clinical-followup.xlsx"),
		backupRoot:     filepath.Join(appRoot, "cold-backups"),
		seatableURL:    env("SEATABLE_URL", "http://seatable:80"),
		adminToken:     os.Getenv("SEATABLE_ADMIN_TOKEN"),
		accessToken:    os.Getenv("SEATABLE_ACCESS_TOKEN"),
		workspaceID:    env("SEATABLE_WORKSPACE_ID", "1"),
		baseName:       os.Getenv("SEATABLE_BASE_NAME"),
		baseUUID:       os.Getenv("SEATABLE_BASE_UUID"),
		deleteExisting: true,
	}
	flag.StringVar(&cfg.xlsxPath, "xlsx", cfg.xlsxPath, "xlsx file to import")
	flag.StringVar(&cfg.backupRoot, "backup-dir", cfg.backupRoot, "cold backup root directory")
	flag.StringVar(&cfg.seatableURL, "seatable-url", cfg.seatableURL, "SeaTable server URL")
	flag.StringVar(&cfg.adminToken, "admin-token", cfg.adminToken, "SeaTable admin API token")
	flag.StringVar(&cfg.accessToken, "access-token", cfg.accessToken, "SeaTable base access token")
	flag.StringVar(&cfg.workspaceID, "workspace-id", cfg.workspaceID, "SeaTable workspace id")
	flag.StringVar(&cfg.baseName, "base-name", cfg.baseName, "SeaTable base name")
	flag.StringVar(&cfg.baseUUID, "base-uuid", cfg.baseUUID, "SeaTable base uuid")
	flag.StringVar(&cfg.tableName, "table-name", cfg.tableName, "new table name; defaults to xlsx sheet name")
	flag.BoolVar(&cfg.deleteExisting, "delete-existing", cfg.deleteExisting, "delete tables that existed before this import")
	flag.BoolVar(&cfg.dryRun, "dry-run", cfg.dryRun, "parse xlsx and print summary without touching SeaTable")
	flag.BoolVar(&cfg.replaceExisting, "replace-existing", cfg.replaceExisting, "replace an existing target table through a temporary table")
	flag.Parse()
	return cfg
}

func run(cfg config) error {
	wb, err := parseXLSX(cfg.xlsxPath)
	if err != nil {
		return err
	}
	if len(wb.Headers) == 0 {
		return errors.New("xlsx header row is empty")
	}
	if cfg.tableName == "" {
		cfg.tableName = wb.SheetName
	}
	if cfg.tableName == "" {
		cfg.tableName = "随访记录"
	}
	if cfg.dryRun {
		fmt.Printf("dry run: table=%s sheet=%s columns=%d rows=%d\n", cfg.tableName, wb.SheetName, len(wb.Headers), len(wb.Rows))
		return nil
	}

	c := &client{cfg: cfg, httpClient: &http.Client{Timeout: 120 * time.Second}}
	token, uuid, err := c.access()
	if err != nil {
		return err
	}
	cfg.accessToken = token
	cfg.baseUUID = uuid
	c.cfg = cfg

	meta, err := c.metadata()
	if err != nil {
		return err
	}
	existing := metadataTableNames(meta)
	if contains(existing, cfg.tableName) && !cfg.replaceExisting {
		return fmt.Errorf("目标表已存在，拒绝覆盖: %s", cfg.tableName)
	}
	createName := cfg.tableName
	if contains(existing, cfg.tableName) && cfg.replaceExisting {
		createName = cfg.tableName + "_导入中_" + time.Now().Format("150405")
	}

	backupDir, err := c.coldBackup(meta, existing, cfg.xlsxPath)
	if err != nil {
		return err
	}
	fmt.Println("cold backup:", backupDir)

	if err := c.addTable(createName, wb); err != nil {
		return err
	}
	fmt.Printf("created table: %s (%d columns, %d rows)\n", createName, len(wb.Headers), len(wb.Rows))

	if cfg.deleteExisting {
		for _, name := range existing {
			if name == createName {
				continue
			}
			if err := c.deleteTable(name); err != nil {
				return fmt.Errorf("delete old table %s: %w", name, err)
			}
			fmt.Println("deleted old table:", name)
		}
	}
	if createName != cfg.tableName {
		if err := c.renameTable(createName, cfg.tableName); err != nil {
			return err
		}
		fmt.Printf("renamed table: %s -> %s\n", createName, cfg.tableName)
	}

	rows, err := c.rows(cfg.tableName)
	if err != nil {
		return err
	}
	if len(rows) != len(wb.Rows) {
		return fmt.Errorf("row count mismatch after import: SeaTable=%d xlsx=%d", len(rows), len(wb.Rows))
	}
	fmt.Printf("verified rows: %d\n", len(rows))
	return nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func (c *client) access() (string, string, error) {
	if c.cfg.accessToken != "" && c.cfg.baseUUID != "" {
		return c.cfg.accessToken, c.cfg.baseUUID, nil
	}
	if c.cfg.adminToken == "" {
		return "", "", errors.New("missing SEATABLE_ADMIN_TOKEN")
	}
	if c.cfg.baseName == "" {
		return "", "", errors.New("missing SEATABLE_BASE_NAME")
	}
	path := fmt.Sprintf("/api/v2.1/workspace/%s/dtable/%s/access-token/", c.cfg.workspaceID, url.PathEscape(c.cfg.baseName))
	var out map[string]any
	if err := c.jsonRequest(http.MethodGet, c.cfg.seatableURL+path, c.cfg.adminToken, nil, &out); err != nil {
		return "", "", err
	}
	token, _ := out["access_token"].(string)
	uuid, _ := out["dtable_uuid"].(string)
	if token == "" || uuid == "" {
		return "", "", errors.New("access-token response missing token or uuid")
	}
	return token, uuid, nil
}

func (c *client) metadata() (map[string]any, error) {
	var out map[string]any
	path := fmt.Sprintf("%s/dtable-server/api/v1/dtables/%s/metadata/", c.cfg.seatableURL, c.cfg.baseUUID)
	if err := c.jsonRequest(http.MethodGet, path, c.cfg.accessToken, nil, &out); err != nil {
		return nil, err
	}
	meta, ok := out["metadata"].(map[string]any)
	if !ok {
		return nil, errors.New("metadata response format invalid")
	}
	return meta, nil
}

func (c *client) addTable(name string, wb parsedWorkbook) error {
	columns := make([]map[string]any, 0, len(wb.Headers))
	for i, header := range wb.Headers {
		columns = append(columns, map[string]any{
			"column_name": header,
			"column_type": "text",
			"column_key":  columnKey(i),
		})
	}
	rows := make([]map[string]any, 0, len(wb.Rows))
	username := tokenUsername(c.cfg.accessToken)
	now := time.Now().Format("2006-01-02T15:04:05.000-07:00")
	for _, source := range wb.Rows {
		row := map[string]any{}
		id, err := newRowID()
		if err != nil {
			return err
		}
		row["_id"] = id
		row["_creator"] = username
		row["_last_modifier"] = username
		row["_ctime"] = now
		row["_mtime"] = now
		row["_archived"] = false
		for i, value := range source {
			if i >= len(wb.Headers) {
				break
			}
			if value != "" {
				row[columnKey(i)] = value
			}
		}
		rows = append(rows, row)
	}
	payload := map[string]any{
		"table_name": name,
		"lang":       "cn",
		"columns":    columns,
		"rows":       rows,
	}
	var out map[string]any
	path := fmt.Sprintf("%s/dtable-server/api/v1/dtables/%s/tables/?from=go_xlsx_import", c.cfg.seatableURL, c.cfg.baseUUID)
	return c.jsonRequest(http.MethodPost, path, c.cfg.accessToken, payload, &out)
}

func (c *client) renameTable(oldName, newName string) error {
	payload := map[string]any{"table_name": oldName, "new_table_name": newName}
	var out map[string]any
	path := fmt.Sprintf("%s/dtable-server/api/v1/dtables/%s/tables/?from=go_xlsx_import", c.cfg.seatableURL, c.cfg.baseUUID)
	return c.jsonRequest(http.MethodPut, path, c.cfg.accessToken, payload, &out)
}

func (c *client) deleteTable(name string) error {
	payload := map[string]any{"table_name": name}
	var out map[string]any
	path := fmt.Sprintf("%s/dtable-server/api/v1/dtables/%s/tables/?from=go_xlsx_import", c.cfg.seatableURL, c.cfg.baseUUID)
	return c.jsonRequest(http.MethodDelete, path, c.cfg.accessToken, payload, &out)
}

func (c *client) rows(tableName string) ([]map[string]any, error) {
	path := fmt.Sprintf("%s/api-gateway/api/v2/dtables/%s/rows/?table_name=%s&limit=10000", c.cfg.seatableURL, c.cfg.baseUUID, url.QueryEscape(tableName))
	var out map[string]any
	if err := c.jsonRequest(http.MethodGet, path, c.cfg.accessToken, nil, &out); err != nil {
		return nil, err
	}
	return asRows(out["rows"]), nil
}

func (c *client) jsonRequest(method, endpoint, token string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Token "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s HTTP %d: %s", method, endpoint, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return err
		}
	}
	return nil
}

func (c *client) coldBackup(meta map[string]any, tables []string, xlsxPath string) (string, error) {
	stamp := time.Now().Format("20060102-150405")
	dir := filepath.Join(c.cfg.backupRoot, stamp)
	if err := os.MkdirAll(filepath.Join(dir, "tables"), 0755); err != nil {
		return "", err
	}
	sum, err := fileSHA256(xlsxPath)
	if err != nil {
		return "", err
	}
	if err := copyFile(xlsxPath, filepath.Join(dir, filepath.Base(xlsxPath))); err != nil {
		return "", err
	}
	if err := writeJSON(filepath.Join(dir, "metadata.json"), meta); err != nil {
		return "", err
	}
	counts := map[string]int{}
	for _, table := range tables {
		rows, err := c.rows(table)
		if err != nil {
			return "", err
		}
		counts[table] = len(rows)
		if err := writeJSON(filepath.Join(dir, "tables", safeName(table)+".json"), map[string]any{
			"name": table,
			"rows": rows,
		}); err != nil {
			return "", err
		}
	}
	for _, path := range []string{
		filepath.Join(c.cfg.appRoot, "public", "followup.json"),
		filepath.Join(c.cfg.appRoot, "dist", "followup.json"),
	} {
		if _, err := os.Stat(path); err == nil {
			_ = copyFile(path, filepath.Join(dir, filepath.Base(filepath.Dir(path))+"-followup.json"))
		}
	}
	manifest := map[string]any{
		"created_at":      time.Now().Format(time.RFC3339),
		"base_name":       c.cfg.baseName,
		"base_uuid":       c.cfg.baseUUID,
		"xlsx_path":       xlsxPath,
		"xlsx_sha256":     sum,
		"existing_tables": tables,
		"row_counts":      counts,
	}
	if err := writeJSON(filepath.Join(dir, "manifest.json"), manifest); err != nil {
		return "", err
	}
	return dir, nil
}

func parseXLSX(path string) (parsedWorkbook, error) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return parsedWorkbook{}, err
	}
	defer reader.Close()
	files := map[string]*zip.File{}
	for _, f := range reader.File {
		files[f.Name] = f
	}
	read := func(name string) ([]byte, error) {
		f := files[name]
		if f == nil {
			return nil, fmt.Errorf("xlsx missing %s", name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(rc)
	}
	workbookXML, err := read("xl/workbook.xml")
	if err != nil {
		return parsedWorkbook{}, err
	}
	sheetName := workbookSheetName(workbookXML)
	shared := []string{}
	if raw, err := read("xl/sharedStrings.xml"); err == nil {
		shared, err = parseSharedStrings(raw)
		if err != nil {
			return parsedWorkbook{}, err
		}
	}
	dateStyles := map[int]bool{}
	if raw, err := read("xl/styles.xml"); err == nil {
		dateStyles = parseDateStyles(raw)
	}
	rawSheet, err := read("xl/worksheets/sheet1.xml")
	if err != nil {
		return parsedWorkbook{}, err
	}
	matrix, err := parseSheet(rawSheet, shared, dateStyles)
	if err != nil {
		return parsedWorkbook{}, err
	}
	headerIndex := -1
	for i, row := range matrix {
		if rowHasValue(row) {
			headerIndex = i
			break
		}
	}
	if headerIndex < 0 {
		return parsedWorkbook{}, errors.New("xlsx has no non-empty rows")
	}
	headers := normalizeHeaders(matrix[headerIndex])
	width := len(headers)
	var rows [][]string
	for _, row := range matrix[headerIndex+1:] {
		if !rowHasValue(row) {
			continue
		}
		out := make([]string, width)
		for i := 0; i < width && i < len(row); i++ {
			out[i] = row[i]
		}
		rows = append(rows, out)
	}
	return parsedWorkbook{SheetName: sheetName, Headers: headers, Rows: rows}, nil
}

func workbookSheetName(raw []byte) string {
	type sheet struct {
		Name string `xml:"name,attr"`
	}
	type workbook struct {
		Sheets []sheet `xml:"sheets>sheet"`
	}
	var wb workbook
	if xml.Unmarshal(raw, &wb) != nil || len(wb.Sheets) == 0 {
		return ""
	}
	return strings.TrimSpace(wb.Sheets[0].Name)
}

func parseSharedStrings(raw []byte) ([]string, error) {
	dec := xml.NewDecoder(bytes.NewReader(raw))
	var out []string
	var b strings.Builder
	inSI := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "si" {
				inSI = true
				b.Reset()
			}
			if inSI && t.Name.Local == "t" {
				var s string
				if err := dec.DecodeElement(&s, &t); err != nil {
					return nil, err
				}
				b.WriteString(s)
			}
		case xml.EndElement:
			if t.Name.Local == "si" {
				out = append(out, b.String())
				inSI = false
			}
		}
	}
}

type worksheetXML struct {
	Rows []rowXML `xml:"sheetData>row"`
}

type rowXML struct {
	R     int       `xml:"r,attr"`
	Cells []cellXML `xml:"c"`
}

type cellXML struct {
	Ref    string          `xml:"r,attr"`
	Type   string          `xml:"t,attr"`
	Style  int             `xml:"s,attr"`
	Value  string          `xml:"v"`
	Inline inlineStringXML `xml:"is"`
}

type inlineStringXML struct {
	Text string `xml:"t"`
}

func parseSheet(raw []byte, shared []string, dateStyles map[int]bool) ([][]string, error) {
	var sheet worksheetXML
	if err := xml.Unmarshal(raw, &sheet); err != nil {
		return nil, err
	}
	var matrix [][]string
	for _, row := range sheet.Rows {
		values := []string{}
		for offset, cell := range row.Cells {
			idx := offset
			if cell.Ref != "" {
				idx = columnIndex(cell.Ref)
			}
			for len(values) <= idx {
				values = append(values, "")
			}
			values[idx] = cellValue(cell, shared, dateStyles)
		}
		matrix = append(matrix, values)
	}
	return matrix, nil
}

func cellValue(cell cellXML, shared []string, dateStyles map[int]bool) string {
	raw := strings.TrimSpace(cell.Value)
	switch cell.Type {
	case "s":
		idx, err := strconv.Atoi(raw)
		if err == nil && idx >= 0 && idx < len(shared) {
			return shared[idx]
		}
		return raw
	case "inlineStr":
		return cell.Inline.Text
	case "b":
		if raw == "1" {
			return "TRUE"
		}
		if raw == "0" {
			return "FALSE"
		}
		return raw
	default:
		if raw != "" && dateStyles[cell.Style] {
			if f, err := strconv.ParseFloat(raw, 64); err == nil {
				return excelSerialDate(f)
			}
		}
		return raw
	}
}

type styleSheetXML struct {
	NumFmts []numFmtXML `xml:"numFmts>numFmt"`
	CellXfs []xfXML     `xml:"cellXfs>xf"`
}

type numFmtXML struct {
	ID   int    `xml:"numFmtId,attr"`
	Code string `xml:"formatCode,attr"`
}

type xfXML struct {
	NumFmtID int `xml:"numFmtId,attr"`
}

func parseDateStyles(raw []byte) map[int]bool {
	var styles styleSheetXML
	if xml.Unmarshal(raw, &styles) != nil {
		return map[int]bool{}
	}
	custom := map[int]bool{}
	for _, f := range styles.NumFmts {
		custom[f.ID] = looksLikeDateFormat(f.Code)
	}
	out := map[int]bool{}
	for i, xf := range styles.CellXfs {
		if builtinDateFormat(xf.NumFmtID) || custom[xf.NumFmtID] {
			out[i] = true
		}
	}
	return out
}

func builtinDateFormat(id int) bool {
	if id >= 14 && id <= 22 {
		return true
	}
	if id >= 27 && id <= 36 {
		return true
	}
	if id >= 45 && id <= 47 {
		return true
	}
	return id >= 50 && id <= 58
}

func looksLikeDateFormat(code string) bool {
	s := strings.ToLower(code)
	return strings.Contains(s, "y") && strings.Contains(s, "d")
}

func excelSerialDate(serial float64) string {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	seconds := int64(serial * 86400)
	t := base.Add(time.Duration(seconds) * time.Second)
	if seconds%86400 == 0 {
		return t.Format("2006-01-02")
	}
	return t.Format("2006-01-02 15:04:05")
}

func normalizeHeaders(in []string) []string {
	out := make([]string, len(in))
	seen := map[string]int{}
	for i, value := range in {
		name := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
		if name == "" {
			name = fmt.Sprintf("Column%d", i+1)
		}
		seen[name]++
		if seen[name] > 1 {
			name = fmt.Sprintf("%s_%d", name, seen[name])
		}
		out[i] = name
	}
	for len(out) > 0 && out[len(out)-1] == fmt.Sprintf("Column%d", len(out)) {
		out = out[:len(out)-1]
	}
	return out
}

func rowHasValue(row []string) bool {
	for _, value := range row {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func columnIndex(ref string) int {
	n := 0
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		n = n*26 + int(r-'A'+1)
	}
	if n == 0 {
		return 0
	}
	return n - 1
}

func columnKey(index int) string {
	if index == 0 {
		return "0000"
	}
	return fmt.Sprintf("C%03d", index)
}

func tokenUsername(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	username, _ := payload["username"].(string)
	return username
}

func newRowID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func metadataTableNames(meta map[string]any) []string {
	var names []string
	for _, table := range asRows(meta["tables"]) {
		if name, _ := table["name"].(string); name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func asRows(value any) []map[string]any {
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

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func safeName(name string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(name)
}

func writeJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0644)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
