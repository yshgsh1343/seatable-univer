package main

import (
	"os"

	"clinical-followup-univer/internal/importer"
)

func main() {
	os.Exit(importer.RunCLI())
}
