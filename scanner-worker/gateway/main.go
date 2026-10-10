package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const maxUploadBytes = 10 * 1024 * 1024

type result struct {
	Verdict          string `json:"verdict"`
	Engine           string `json:"engine"`
	EngineVersion    string `json:"engineVersion"`
	SignatureVersion string `json:"signatureVersion"`
	Threat           string `json:"threat,omitempty"`
	ScannedAt        string `json:"scannedAt"`
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("POST /scan", scan)
	server := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       75 * time.Second,
		WriteTimeout:      75 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}

func health(w http.ResponseWriter, _ *http.Request) {
	version, err := clamdCommand("zVERSION\x00")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false})
		return
	}
	engine, engineVersion, signatures := parseVersion(version)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "engine": engine, "engineVersion": engineVersion, "signatureVersion": signatures,
	})
}

func scan(w http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(w, request.Body, maxUploadBytes)
	ctx, cancel := context.WithTimeout(request.Context(), 60*time.Second)
	defer cancel()
	version, err := clamdCommand("zVERSION\x00")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"verdict": "ERROR"})
		return
	}
	reply, err := streamScan(ctx, request.Body)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, http.ErrBodyReadAfterClose) || strings.Contains(err.Error(), "too large") {
			status = http.StatusRequestEntityTooLarge
		}
		writeJSON(w, status, map[string]any{"verdict": "ERROR"})
		return
	}
	engine, engineVersion, signatures := parseVersion(version)
	output := result{
		Engine: engine, EngineVersion: engineVersion, SignatureVersion: signatures,
		ScannedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	switch {
	case strings.HasSuffix(reply, " OK"):
		output.Verdict = "CLEAN"
	case strings.HasSuffix(reply, " FOUND"):
		output.Verdict = "INFECTED"
		name := strings.TrimSuffix(strings.TrimPrefix(reply, "stream: "), " FOUND")
		output.Threat = truncate(name, 160)
	default:
		output.Verdict = "ERROR"
	}
	writeJSON(w, http.StatusOK, output)
}

func streamScan(ctx context.Context, source io.Reader) (string, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", "127.0.0.1:3310")
	if err != nil {
		return "", err
	}
	defer connection.Close()
	deadline, ok := ctx.Deadline()
	if ok {
		_ = connection.SetDeadline(deadline)
	}
	if _, err = connection.Write([]byte("zINSTREAM\x00")); err != nil {
		return "", err
	}
	buffer := make([]byte, 64*1024)
	total := 0
	for {
		count, readErr := source.Read(buffer)
		if count > 0 {
			total += count
			if total > maxUploadBytes {
				return "", fmt.Errorf("file too large")
			}
			header := make([]byte, 4)
			binary.BigEndian.PutUint32(header, uint32(count))
			if _, err = connection.Write(header); err != nil {
				return "", err
			}
			if _, err = connection.Write(buffer[:count]); err != nil {
				return "", err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	if _, err = connection.Write([]byte{0, 0, 0, 0}); err != nil {
		return "", err
	}
	reply, err := bufio.NewReader(connection).ReadString(0)
	return strings.TrimSpace(strings.TrimSuffix(reply, "\x00")), err
}

func clamdCommand(command string) (string, error) {
	connection, err := net.DialTimeout("tcp", "127.0.0.1:3310", 5*time.Second)
	if err != nil {
		return "", err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err = connection.Write([]byte(command)); err != nil {
		return "", err
	}
	reply, err := bufio.NewReader(connection).ReadString(0)
	return strings.TrimSpace(strings.TrimSuffix(reply, "\x00")), err
}

func parseVersion(value string) (string, string, string) {
	parts := strings.Split(value, "/")
	engine := "ClamAV"
	engineVersion := "unknown"
	signatureVersion := "unknown"
	if len(parts) > 0 {
		fields := strings.Fields(parts[0])
		if len(fields) > 0 {
			engine = fields[0]
		}
		if len(fields) > 1 {
			engineVersion = fields[1]
		}
	}
	if len(parts) > 1 {
		signatureVersion = parts[1]
	}
	return engine, engineVersion, signatureVersion
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
