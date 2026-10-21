package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestSignatureCompatibleWithUFI(t *testing.T) {
	got := signature("GET", "/api/baseDeviceInfo", "1770000000000")
	if got != "9af41aa4cfd984da1a0cf2a80c04734cd36b6503ad1328eacc5064d4ee9a17b1" {
		t.Fatal(got)
	}
}
func TestBoundedLogRotatesAndRestores(t *testing.T) {
	dir := t.TempDir()
	log, err := openLog(dir, 480)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		if err = log.Append(Record{"sample", int64(i + 1), map[string]any{"temperature_c": i, "payload": strings.Repeat("x", 30)}}); err != nil {
			t.Fatal(err)
		}
	}
	if err = log.Close(); err != nil {
		t.Fatal(err)
	}
	var bytes int64
	var count int
	var last float64
	files, _ := filepath.Glob(filepath.Join(dir, "records-*.jsonl"))
	if len(files) > segmentCount {
		t.Fatal("too many segments")
	}
	for i := segmentCount - 1; i >= 0; i-- {
		b, e := os.ReadFile(filepath.Join(dir, logName(i)))
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			t.Fatal(e)
		}
		bytes += int64(len(b))
		if len(b) > 480 {
			t.Fatal("segment exceeded cap")
		}
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			var r Record
			if e = json.Unmarshal([]byte(line), &r); e != nil {
				t.Fatal(e)
			}
			last = r.Data["temperature_c"].(float64)
			count++
		}
	}
	if bytes > 480*segmentCount || last != 99 || count >= 100 {
		t.Fatal(bytes, last, count)
	}
	r := &Recorder{home: dir}
	r.restore()
	if len(r.history) != count || r.history[len(r.history)-1].At != 100 {
		t.Fatal("restore did not preserve retained records")
	}
}
func TestDetectorIgnoresMissingFieldsAndUsesTemperatureHysteresis(t *testing.T) {
	d := &Detector{}
	first := map[string]any{"network_type": "5G", "Nr_pci": "11", "temperature_c": 74.0, "Z5g_rsrp": -90.0}
	if len(d.Sample(first)) != 0 {
		t.Fatal("initial values are not transitions")
	}
	second := map[string]any{"network_type": "5G", "Nr_pci": "12", "temperature_c": 76.0, "Z5g_rsrp": -105.0}
	if got := d.Sample(second); len(got) != 3 {
		t.Fatal(got)
	}
	if got := d.Sample(map[string]any{"temperature_c": 74.0}); len(got) != 0 {
		t.Fatal("missing radio values produced false change", got)
	}
	if got := d.Sample(map[string]any{"temperature_c": 69.0}); len(got) != 1 || got[0]["event"] != "temperature_recovered" {
		t.Fatal(got)
	}
}
func TestAPIWhitelistAndAuthentication(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "private-token" || r.Header.Get("kano-sign") != signature("GET", r.URL.Path, r.Header.Get("kano-t")) {
			t.Error("bad authentication")
		}
		if r.URL.Path == "/api/baseDeviceInfo" {
			fmt.Fprint(w, `{"cpu_temp":54057,"cpu_usage":4.3,"mem_usage":60,"imei":"sensitive","cookie":"private","daily_data":123}`)
		} else {
			if r.URL.Query().Get("cmd") != radioQuery {
				t.Error("query must not separately request expanded fields")
			}
			fmt.Fprint(w, `{"network_type":20,"Z5g_rsrp":-105,"Nr_bands":1,"Nr_pci":"","imsi":"sensitive","password":"private"}`)
		}
	}))
	defer server.Close()
	a := &API{Config{server.URL, "private-token"}, server.Client()}
	m := a.Sample(context.Background())
	if m["temperature_c"] != 54.057 || m["Z5g_rsrp"] != float64(-105) || m["network_type"] != "5G" || m["Nr_bands"] != float64(1) {
		t.Fatal(m)
	}
	b, _ := json.Marshal(m)
	for _, s := range []string{"imei", "imsi", "cookie", "password", "private", "sensitive", "Nr_pci"} {
		if strings.Contains(string(b), s) {
			t.Fatal("unexpected retained field", string(b))
		}
	}
}
func TestAPIReportsFailureWithoutRetainingBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, "a private diagnostic body")
	}))
	defer server.Close()
	a := &API{Config{server.URL, "token"}, server.Client()}
	m := a.Sample(context.Background())
	b, _ := json.Marshal(m)
	if strings.Contains(string(b), "private") || m["base_error"] == nil || m["radio_error"] == nil {
		t.Fatal(string(b))
	}
}
func TestEchoAndDNSRejectUnrelatedResponses(t *testing.T) {
	sent := make([]byte, 24)
	sent[0] = 8
	sent[4] = 21
	sent[5] = 11
	sent[23] = 89
	reply := append([]byte(nil), sent...)
	reply[0] = 0
	binary.BigEndian.PutUint16(reply[2:4], checksum(reply))
	if !matchingEcho(reply, sent) {
		t.Fatal("valid echo rejected")
	}
	reply[23]++
	if matchingEcho(reply, sent) {
		t.Fatal("unrelated or corrupt echo accepted")
	}
	q := dnsPacket()
	r := append([]byte(nil), q...)
	r[2] = 128
	r[7] = 1
	if !validDNS(r, q) {
		t.Fatal("valid DNS rejected")
	}
	r[0]++
	if validDNS(r, q) {
		t.Fatal("wrong transaction accepted")
	}
	r[0]--
	r[3] = 3
	if validDNS(r, q) {
		t.Fatal("negative response accepted")
	}
}
func TestExportRejectsTraversalAndRotation(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, logName(0))
	os.WriteFile(name, []byte("old\n"), 0600)
	s, _ := os.Stat(name)
	inode := fmt.Sprint(s.Sys().(*syscall.Stat_t).Ino)
	if exportChunk(dir, []string{"../config.json", "0", "4", inode}) == nil {
		t.Fatal("path traversal accepted")
	}
	os.Rename(name, name+".old")
	os.WriteFile(name, []byte("newer record\n"), 0600)
	if exportChunk(dir, []string{logName(0), "0", "4", inode}) == nil {
		t.Fatal("rotated log accepted")
	}
	if exportChunk(dir, []string{logName(0), "-1", "4", inode}) == nil {
		t.Fatal("negative offset accepted")
	}
}
func TestInterruptedFinalRecordIsRepaired(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, logName(0))
	good := `{"kind":"sample","at":1,"data":{}}` + "\n"
	os.WriteFile(file, []byte(good+`{"kind":"sample","at":`), 0600)
	l, e := openLog(dir, segmentBytes)
	if e != nil {
		t.Fatal(e)
	}
	if e = l.Append(Record{"sample", 2, map[string]any{}}); e != nil {
		t.Fatal(e)
	}
	l.Close()
	r := &Recorder{home: dir}
	r.restore()
	if len(r.history) != 2 || r.history[1].At != 2 {
		t.Fatal(r.history)
	}
}
