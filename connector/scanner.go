package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// PMSInfo holds detected PMS details
type PMSInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version,omitempty"`
	DBType    string `json:"db_type"`
	DBHost    string `json:"db_host"`
	DBPort    int    `json:"db_port,omitempty"`
	DBPath    string `json:"db_path,omitempty"`
	Confidence string `json:"confidence"` // "high", "medium", "low"
}

// knownPMSSystems lists common pharmacy management systems and their signatures
var knownPMSSystems = []struct {
	Name       string
	Dirs       []string
	ProcessNames []string
	DBType     string
	DBPort     int
}{
	{
		Name:         "VirtualRx",
		Dirs:         []string{`C:\Program Files\VirtualRx`, `C:\VirtualRx`},
		ProcessNames: []string{"virtualrx.exe", "vrx.exe"},
		DBType:       "mysql",
		DBPort:       3306,
	},
	{
		Name:         "MedPro",
		Dirs:         []string{`C:\Program Files\MedPro`, `C:\MedPro`, `C:\Program Files (x86)\MedPro`},
		ProcessNames: []string{"medpro.exe", "medprorx.exe"},
		DBType:       "mssql",
		DBPort:       1433,
	},
	{
		Name:         "HealthTrac",
		Dirs:         []string{`C:\Program Files\HealthTrac`, `C:\HealthTrac`},
		ProcessNames: []string{"healthtrac.exe", "htrac.exe"},
		DBType:       "mysql",
		DBPort:       3306,
	},
	{
		Name:         "Galen",
		Dirs:         []string{`C:\Program Files\Galen`, `C:\GalenRx`, `C:\Program Files (x86)\Galen`},
		ProcessNames: []string{"galen.exe", "galenrx.exe"},
		DBType:       "sqlite",
		DBPort:       0,
	},
	{
		Name:         "Bewell",
		Dirs:         []string{`C:\Program Files\Bewell`, `C:\Bewell`},
		ProcessNames: []string{"bewell.exe", "bewellpharm.exe"},
		DBType:       "mysql",
		DBPort:       3306,
	},
	{
		Name:         "RxOne",
		Dirs:         []string{`C:\Program Files\RxOne`, `C:\RxOne`},
		ProcessNames: []string{"rxone.exe"},
		DBType:       "mssql",
		DBPort:       1433,
	},
	{
		Name:         "PioneerRx",
		Dirs:         []string{`C:\Program Files\PioneerRx`, `C:\PioneerRx`},
		ProcessNames: []string{"pioneeerx.exe", "prx.exe"},
		DBType:       "mysql",
		DBPort:       3306,
	},
}

// ScanForPMS tries to identify the PMS software using multiple detection strategies.
// Returns nil if nothing is detected.
func ScanForPMS() *PMSInfo {
	// Strategy 1: Check known install directories
	for _, pms := range knownPMSSystems {
		for _, dir := range pms.Dirs {
			if _, err := os.Stat(dir); err == nil {
				log.Printf("[Scanner] Found PMS directory: %s → %s", dir, pms.Name)
				info := &PMSInfo{
					Name:       pms.Name,
					DBType:     pms.DBType,
					DBHost:     "127.0.0.1",
					DBPort:     pms.DBPort,
					Confidence: "high",
				}
				// Look for SQLite .db files inside the directory
				if pms.DBType == "sqlite" {
					if dbPath := findSQLiteDB(dir); dbPath != "" {
						info.DBPath = dbPath
					}
				}
				return info
			}
		}
	}

	// Strategy 2: Check running processes
	detected := getRunningProcesses()
	for _, pms := range knownPMSSystems {
		for _, procName := range pms.ProcessNames {
			for _, running := range detected {
				if strings.EqualFold(running, procName) {
					log.Printf("[Scanner] Detected PMS process: %s → %s", procName, pms.Name)
					return &PMSInfo{
						Name:       pms.Name,
						DBType:     pms.DBType,
						DBHost:     "127.0.0.1",
						DBPort:     pms.DBPort,
						Confidence: "medium",
					}
				}
			}
		}
	}

	// Strategy 3: Check open ports
	for _, pms := range knownPMSSystems {
		if pms.DBPort > 0 && isPortOpen("127.0.0.1", pms.DBPort) {
			log.Printf("[Scanner] Detected open port %d → likely %s", pms.DBPort, pms.Name)
			return &PMSInfo{
				Name:       pms.Name + " (unconfirmed)",
				DBType:     pms.DBType,
				DBHost:     "127.0.0.1",
				DBPort:     pms.DBPort,
				Confidence: "low",
			}
		}
	}

	log.Println("[Scanner] No PMS detected automatically.")
	return nil
}

// getRunningProcesses returns a list of running process names on Windows
func getRunningProcesses() []string {
	out, err := exec.Command("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(string(out), "\n")
	names := make([]string, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, ",", 2)
		if len(parts) > 0 {
			name := strings.Trim(strings.TrimSpace(parts[0]), `"`)
			names = append(names, name)
		}
	}
	return names
}

// isPortOpen checks whether a TCP port is open on localhost
func isPortOpen(host string, port int) bool {
	address := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", address, 500*1000*1000) // 500ms
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// findSQLiteDB searches a directory tree for any .db file
func findSQLiteDB(root string) string {
	var found string
	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".db") {
			found = path
		}
		return nil
	})
	return found
}
