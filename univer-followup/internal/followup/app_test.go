package followup

import (
	"os"
	"path/filepath"
	"testing"
)

func testApp(t *testing.T) *app {
	t.Helper()
	root := t.TempDir()
	return newApp(appConfig{
		root:                root,
		dist:                filepath.Join(root, "dist"),
		publicJSON:          filepath.Join(root, "public", "followup.json"),
		distJSON:            filepath.Join(root, "dist", "followup.json"),
		backupDir:           filepath.Join(root, "sync-backups"),
		seatableWorkspaceID: "1",
	})
}

func TestBasePayloadCacheIsSeparated(t *testing.T) {
	a := testApp(t)
	payloadA := map[string]any{
		"patients":         []map[string]any{{"patient_id": "A-1"}},
		"drug_sensitivity": []map[string]any{},
		"followups":        []map[string]any{},
	}
	payloadB := map[string]any{
		"patients":         []map[string]any{{"patient_id": "B-1"}},
		"drug_sensitivity": []map[string]any{},
		"followups":        []map[string]any{},
	}

	if _, err := a.savePayload(payloadA, nil, "Base A", "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.savePayload(payloadB, nil, "Base B", "2"); err != nil {
		t.Fatal(err)
	}

	gotA, ok := a.currentStructuredPayload("Base A", "1")
	if !ok {
		t.Fatal("expected Base A payload")
	}
	if id := asRows(gotA["patients"])[0]["patient_id"]; id != "A-1" {
		t.Fatalf("Base A cache returned %v", id)
	}

	gotB, ok := a.currentStructuredPayload("Base B", "2")
	if !ok {
		t.Fatal("expected Base B payload")
	}
	if id := asRows(gotB["patients"])[0]["patient_id"]; id != "B-1" {
		t.Fatalf("Base B cache returned %v", id)
	}

	if _, ok := a.currentStructuredPayload("Base A", "2"); ok {
		t.Fatal("cross-workspace cache lookup should not match")
	}
	if _, err := os.Stat(a.basePayloadPath(a.cfg.publicJSON, "Base A", "1")); err != nil {
		t.Fatalf("expected base-specific public cache: %v", err)
	}
}

func TestDeletedRawRowsRequireExplicitIDs(t *testing.T) {
	payload := map[string]any{
		"changed_raw_tables": []string{"Sheet1"},
		"raw_tables": []map[string]any{{
			"name":    "Sheet1",
			"columns": []string{"Name"},
			"rows":    []map[string]any{{"_id": "kept", "Name": "A"}},
		}},
	}
	if got := deletedRawRowIDs(payload, "Sheet1"); len(got) != 0 {
		t.Fatalf("implicit row omission produced deletions: %#v", got)
	}

	payload["deleted_raw_rows"] = map[string]any{"Sheet1": []any{"removed"}}
	got := deletedRawRowIDs(payload, "Sheet1")
	if !got["removed"] || len(got) != 1 {
		t.Fatalf("explicit deletion IDs not parsed: %#v", got)
	}
}

func TestCoerceWritableValueForSimpleTypedColumns(t *testing.T) {
	if got := coerceWritableValue("1,234.5", map[string]any{"type": "number"}); got != 1234.5 {
		t.Fatalf("number was not coerced: %#v", got)
	}
	if got := coerceWritableValue("是", map[string]any{"type": "checkbox"}); got != true {
		t.Fatalf("checkbox was not coerced: %#v", got)
	}
	if got := coerceWritableValue("A", map[string]any{"type": "single-select"}); got != "A" {
		t.Fatalf("select value should remain text: %#v", got)
	}
}
