package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	PORT    = "3002"
	VERSION = "1.0.0"
)

// StatusResponse is the JSON returned by /status
type StatusResponse struct {
	Running   bool      `json:"running"`
	Version   string    `json:"version"`
	Timestamp time.Time `json:"timestamp"`
	PMS       *PMSInfo  `json:"pms,omitempty"`
}

func main() {
	// Set up logging to a file next to the executable
	exePath, _ := os.Executable()
	logPath := filepath.Join(filepath.Dir(exePath), "pst-connector.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err == nil {
		log.SetOutput(logFile)
	}

	log.Printf("[PST] Connector v%s starting...", VERSION)

	// We are using the manual/click-to-install flow, so no registry injection is performed here.
	log.Println("[PST] Desktop connector is running and ready for extension connection.")

	// Start the local HTTP API
	mux := http.NewServeMux()
	mux.HandleFunc("/status", corsMiddleware(handleStatus))
	mux.HandleFunc("/scan", corsMiddleware(handleScan))
	mux.HandleFunc("/extract", corsMiddleware(handleExtract))

	addr := fmt.Sprintf("127.0.0.1:%s", PORT)
	log.Printf("[PST] API server listening on http://%s", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[PST] Fatal: could not start server: %v", err)
	}
}

// corsMiddleware adds CORS headers so chat.html can call the local API
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// GET /status — returns connector health and version
func handleStatus(w http.ResponseWriter, r *http.Request) {
	pms := ScanForPMS()
	writeJSON(w, http.StatusOK, StatusResponse{
		Running:   true,
		Version:   VERSION,
		Timestamp: time.Now(),
		PMS:       pms,
	})
}

// GET /scan — returns detected PMS info
func handleScan(w http.ResponseWriter, r *http.Request) {
	pms := ScanForPMS()
	if pms == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"detected": false,
			"message":  "No known PMS detected automatically.",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"detected": true,
		"pms":      pms,
	})
}

// POST /extract — runs the DB extractor for the given PMS config
func handleExtract(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PMS    string `json:"pms"`
		DBPath string `json:"db_path,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	result, err := ExtractData(req.PMS, req.DBPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}
