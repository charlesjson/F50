// UFI Blackbox records a small, explicit set of metrics. Its control socket is
// local and private; the browser reaches it through UFI's authenticated shell.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const version = "0.1.0"
const defaultHome = "/data/adb/ufi-blackbox"
const segmentBytes = 4 * 1024 * 1024
const segmentCount = 5
const radioQuery = "network_type,ppp_status,Z5g_rsrp,lte_rsrp,network_information"
const radioFields = "network_type,ppp_status,Z5g_rsrp,lte_rsrp,lte_rsrq,lte_snr,Lte_snr,Nr_snr,Lte_bands,Lte_fcn,Lte_pci,Lte_cell_id,Nr_bands,Nr_fcn,Nr_pci,Nr_cell_id,network_information,nr_rsrp,nr_rsrq,Nr_signal_strength,Lte_signal_strength"

type Config struct {
	Address       string `json:"address"`
	Authorization string `json:"authorization"`
}

type Record struct {
	Kind string         `json:"kind"`
	At   int64          `json:"at"`
	Data map[string]any `json:"data"`
}

// Log is single-writer, buffered, and bounded including its unflushed bytes.
type Log struct {
	home   string
	limit  int64
	file   *os.File
	writer *bufio.Writer
	size   int64
	err    error
}

func logName(i int) string { return fmt.Sprintf("records-%d.jsonl", i) }
func openLog(home string, limit int64) (*Log, error) {
	l := &Log{home: home, limit: limit}
	if err := os.MkdirAll(home, 0700); err != nil {
		return nil, err
	}
	err := l.open()
	return l, err
}
func (l *Log) open() error {
	f, err := os.OpenFile(filepath.Join(l.home, logName(0)), os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	s, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	// Discard only an interrupted final record, preserving all complete lines.
	if s.Size() > 0 {
		start := max(int64(0), s.Size()-65536)
		tail := make([]byte, s.Size()-start)
		if _, err = f.ReadAt(tail, start); err != nil {
			f.Close()
			return err
		}
		if tail[len(tail)-1] != '\n' {
			end := start + int64(bytes.LastIndexByte(tail, '\n')) + 1
			if err = f.Truncate(end); err != nil {
				f.Close()
				return err
			}
			s, err = f.Stat()
			if err != nil {
				f.Close()
				return err
			}
		}
	}
	l.file, l.writer, l.size = f, bufio.NewWriterSize(f, 16384), s.Size()
	return nil
}
func (l *Log) Append(r Record) error {
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if int64(len(b)) > l.limit {
		return errors.New("record exceeds segment limit")
	}
	if l.size+int64(len(b)) > l.limit {
		if err := l.Flush(); err != nil {
			return err
		}
		if err := l.file.Close(); err != nil {
			return err
		}
		oldest := filepath.Join(l.home, logName(segmentCount-1))
		if err := os.Remove(oldest); err != nil && !os.IsNotExist(err) {
			return err
		}
		for i := segmentCount - 2; i >= 0; i-- {
			if err := os.Rename(filepath.Join(l.home, logName(i)), filepath.Join(l.home, logName(i+1))); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		if err := l.open(); err != nil {
			return err
		}
	}
	n, err := l.writer.Write(b)
	l.size += int64(n)
	return err
}
func (l *Log) Flush() error { return l.writer.Flush() }
func (l *Log) Close() error {
	err := l.Flush()
	e := l.file.Close()
	if err != nil {
		return err
	}
	return e
}
func (l *Log) Bytes() int64 {
	total := l.size
	for i := 1; i < segmentCount; i++ {
		if s, e := os.Stat(filepath.Join(l.home, logName(i))); e == nil {
			total += s.Size()
		}
	}
	return total
}

type Detector struct {
	previous   map[string]any
	hot        bool
	probeState string
	dnsState   string
}

func valid(v any) bool { return v != nil && fmt.Sprint(v) != "" && fmt.Sprint(v) != "--" }
func numeric(v any) (float64, bool) {
	if !valid(v) {
		return 0, false
	}
	f, e := strconv.ParseFloat(strings.TrimSuffix(fmt.Sprint(v), "%"), 64)
	return f, e == nil
}
func (d *Detector) Sample(m map[string]any) []map[string]any {
	var events []map[string]any
	add := func(name string, extra map[string]any) { extra["event"] = name; events = append(events, extra) }
	if d.previous != nil {
		for _, key := range []string{"base_error", "radio_error"} {
			before, after := valid(d.previous[key]), valid(m[key])
			if before != after {
				add("source_change", map[string]any{"field": key, "available": !after})
			}
		}
		for _, key := range []string{"network_type", "ppp_status", "Lte_cell_id", "Nr_cell_id", "Lte_pci", "Nr_pci", "Lte_bands", "Nr_bands"} {
			if valid(m[key]) && valid(d.previous[key]) && fmt.Sprint(m[key]) != fmt.Sprint(d.previous[key]) {
				add("radio_change", map[string]any{"field": key, "before": d.previous[key], "after": m[key]})
			}
		}
		for _, key := range []string{"Z5g_rsrp", "lte_rsrp"} {
			n, ok := numeric(m[key])
			p, old := numeric(d.previous[key])
			if ok && old && n < 0 && p < 0 && n-p <= -12 && m["network_type"] == d.previous["network_type"] {
				add("signal_drop", map[string]any{"field": key, "before": p, "after": n, "change_db": n - p})
			}
		}
	}
	if t, ok := numeric(m["temperature_c"]); ok {
		if !d.hot && t >= 75 {
			d.hot = true
			add("temperature_high", map[string]any{"temperature_c": t})
		}
		if d.hot && t <= 70 {
			d.hot = false
			add("temperature_recovered", map[string]any{"temperature_c": t})
		}
	}
	d.previous = m
	return events
}
func (d *Detector) Probe(m map[string]any) []map[string]any {
	var events []map[string]any
	for _, p := range []struct {
		key      string
		previous *string
	}{{"icmp_state", &d.probeState}, {"dns_state", &d.dnsState}} {
		state, _ := m[p.key].(string)
		if *p.previous != "" && state != *p.previous {
			events = append(events, map[string]any{"event": "probe_change", "field": p.key, "before": *p.previous, "after": state})
		}
		*p.previous = state
	}
	return events
}

func signature(method, path, stamp string) string {
	m := hmac.New(md5.New, []byte("minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd"))
	m.Write([]byte("minikano" + method + path + stamp))
	b := m.Sum(nil)
	x, y := sha256.Sum256(b[:8]), sha256.Sum256(b[8:])
	z := sha256.Sum256(append(x[:], y[:]...))
	return hex.EncodeToString(z[:])
}

type API struct {
	config Config
	client *http.Client
}

func (a *API) Get(ctx context.Context, path string) (map[string]any, error) {
	r, e := http.NewRequestWithContext(ctx, "GET", a.config.Address+path, nil)
	if e != nil {
		return nil, e
	}
	stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	r.Header.Set("authorization", a.config.Authorization)
	r.Header.Set("kano-t", stamp)
	r.Header.Set("kano-sign", signature("GET", strings.SplitN(path, "?", 2)[0], stamp))
	response, e := a.client.Do(r)
	if e != nil {
		return nil, errors.New("local UFI request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("local UFI HTTP %d", response.StatusCode)
	}
	var data map[string]any
	if e = json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(&data); e != nil {
		return nil, errors.New("invalid UFI response")
	}
	if data["error"] != nil {
		return nil, errors.New("UFI returned an error")
	}
	return data, nil
}
func (a *API) Sample(ctx context.Context) map[string]any {
	m := map[string]any{}
	base, e := a.Get(ctx, "/api/baseDeviceInfo")
	if e != nil {
		m["base_error"] = e.Error()
	} else {
		for _, key := range []string{"cpu_usage", "mem_usage", "daily_data", "monthly_data"} {
			if valid(base[key]) {
				m[key] = base[key]
			}
		}
		if t, ok := numeric(base["cpu_temp"]); ok {
			if t > 1000 {
				t /= 1000
			}
			m["temperature_c"] = t
		}
	}
	// Request the firmware's aggregate. Asking goform for its expanded keys
	// separately can overwrite the aggregate's valid values with empty strings.
	n, e := a.Get(ctx, "/api/goform/goform_get_cmd_process?"+url.Values{"cmd": {radioQuery}, "multi_data": {"1"}, "isTest": {"false"}}.Encode())
	if e != nil {
		m["radio_error"] = e.Error()
	} else {
		for _, key := range strings.Split(radioFields, ",") {
			if key != "network_information" && valid(n[key]) {
				m[key] = n[key]
			}
		}
		// F50's network_information expands into radio fields and returns the
		// Android Telephony network type number instead of the goform label.
		if code, ok := numeric(m["network_type"]); ok {
			switch int(code) {
			case 20:
				m["network_type"] = "5G"
			case 13, 19:
				m["network_type"] = "4G"
			case 3, 5, 6, 8, 9, 10, 12, 14, 15, 17:
				m["network_type"] = "3G"
			case 1, 2, 4, 7, 11, 16:
				m["network_type"] = "2G"
			}
		}
	}
	return m
}

func checksum(b []byte) uint16 {
	var sum uint32
	for len(b) > 1 {
		sum += uint32(binary.BigEndian.Uint16(b))
		b = b[2:]
	}
	if len(b) > 0 {
		sum += uint32(b[0]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 65535) + (sum >> 16)
	}
	return ^uint16(sum)
}
func matchingEcho(b, sent []byte) bool {
	return len(b) >= len(sent) && b[0] == 0 && b[1] == 0 && string(b[4:len(sent)]) == string(sent[4:]) && checksum(b) == 0
}
func ping(target string) map[string]any {
	result := map[string]any{"target": target, "ok": false}
	c, e := net.ListenPacket("ip4:icmp", "0.0.0.0")
	if e != nil {
		result["error"] = "icmp_unavailable"
		return result
	}
	defer c.Close()
	packet := make([]byte, 24)
	packet[0] = 8
	rand.Read(packet[4:])
	binary.BigEndian.PutUint16(packet[2:4], checksum(packet))
	started := time.Now()
	c.SetDeadline(started.Add(2 * time.Second))
	if _, e = c.WriteTo(packet, &net.IPAddr{IP: net.ParseIP(target)}); e != nil {
		result["error"] = "send_failed"
		return result
	}
	buf := make([]byte, 1500)
	for {
		n, from, e := c.ReadFrom(buf)
		if e != nil {
			result["error"] = "no_reply"
			return result
		}
		if from.String() == target && matchingEcho(buf[:n], packet) {
			result["ok"] = true
			result["latency_ms"] = float64(time.Since(started).Microseconds()) / 1000
			return result
		}
	}
}
func dnsPacket() []byte {
	b := make([]byte, 12)
	rand.Read(b[:2])
	b[2] = 1
	b[5] = 1
	for _, label := range strings.Split("www.baidu.com", ".") {
		b = append(b, byte(len(label)))
		b = append(b, label...)
	}
	return append(b, 0, 0, 1, 0, 1)
}
func validDNS(b, query []byte) bool {
	return len(b) >= 12 && b[0] == query[0] && b[1] == query[1] && b[2]&128 != 0 && b[2]&2 == 0 && b[3]&15 == 0 && binary.BigEndian.Uint16(b[6:8]) > 0
}
func dnsProbe() map[string]any {
	r := map[string]any{"target": "223.5.5.5", "domain": "www.baidu.com", "ok": false}
	c, e := net.DialTimeout("udp4", "223.5.5.5:53", 2*time.Second)
	if e != nil {
		r["error"] = "dns_unavailable"
		return r
	}
	defer c.Close()
	b := dnsPacket()
	started := time.Now()
	c.SetDeadline(started.Add(2 * time.Second))
	if _, e = c.Write(b); e != nil {
		r["error"] = "send_failed"
		return r
	}
	buf := make([]byte, 1500)
	n, e := c.Read(buf)
	if e != nil {
		r["error"] = "no_reply"
	} else if !validDNS(buf[:n], b) {
		r["error"] = "invalid_or_negative_reply"
	} else {
		r["ok"] = true
		r["latency_ms"] = float64(time.Since(started).Microseconds()) / 1000
	}
	return r
}
func probe() map[string]any {
	var wg sync.WaitGroup
	wg.Add(3)
	results := make([]map[string]any, 2)
	var dns map[string]any
	for i, target := range []string{"223.5.5.5", "119.29.29.29"} {
		go func(i int, target string) { defer wg.Done(); results[i] = ping(target) }(i, target)
	}
	go func() { defer wg.Done(); dns = dnsProbe() }()
	wg.Wait()
	ok := 0
	for _, r := range results {
		if r["ok"] == true {
			ok++
		}
	}
	state := []string{"no_reply", "partial", "reachable"}[ok]
	dnsState := "no_reply"
	if dns["ok"] == true {
		dnsState = "resolved"
	}
	return map[string]any{"icmp": results, "dns": dns, "icmp_state": state, "dns_state": dnsState}
}

type Recorder struct {
	mu         sync.Mutex
	home       string
	log        *Log
	detector   Detector
	history    []Record
	started    int64
	lastSample int64
	lastProbe  int64
	logError   string
	stop       context.CancelFunc
}

func (r *Recorder) remember(record Record) {
	r.history = append(r.history, record)
	if len(r.history) > 720 {
		r.history = append([]Record(nil), r.history[len(r.history)-720:]...)
	}
}
func (r *Recorder) addLocked(record Record) {
	r.remember(record)
	if e := r.log.Append(record); e != nil {
		r.logError = e.Error()
	}
}
func (r *Recorder) record(kind string, data map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record := Record{kind, time.Now().UnixMilli(), data}
	r.addLocked(record)
	var events []map[string]any
	if kind == "sample" {
		r.lastSample = record.At
		events = r.detector.Sample(data)
	}
	if kind == "probe" {
		r.lastProbe = record.At
		events = r.detector.Probe(data)
	}
	for _, e := range events {
		r.addLocked(Record{"event", record.At, e})
	}
}
func (r *Recorder) restore() {
	for i := segmentCount - 1; i >= 0; i-- {
		f, e := os.Open(filepath.Join(r.home, logName(i)))
		if e != nil {
			continue
		}
		s := bufio.NewScanner(io.LimitReader(f, segmentBytes))
		s.Buffer(make([]byte, 4096), 65536)
		for s.Scan() {
			var item Record
			if json.Unmarshal(s.Bytes(), &item) == nil && item.At > 0 && (item.Kind == "sample" || item.Kind == "probe" || item.Kind == "event") {
				r.remember(item)
			}
		}
		f.Close()
	}
}
func ownRSS() int64 {
	b, _ := os.ReadFile("/proc/self/status")
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) > 1 {
				n, _ := strconv.ParseInt(fields[1], 10, 64)
				return n
			}
		}
	}
	return 0
}
func (r *Recorder) status() map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return map[string]any{"version": version, "running": true, "pid": os.Getpid(), "started_at": r.started, "last_sample_at": r.lastSample, "last_probe_at": r.lastProbe, "sample_interval_seconds": 15, "probe_interval_seconds": 30, "log_limit_bytes": segmentBytes * segmentCount, "log_bytes": r.log.Bytes(), "log_error": r.logError, "rss_kb": ownRSS(), "heap_bytes": mem.HeapAlloc, "records": r.history}
}

type Request struct {
	Action string `json:"action"`
}

func (r *Recorder) handle(c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	var req Request
	if json.NewDecoder(io.LimitReader(c, 1024)).Decode(&req) != nil {
		return
	}
	if req.Action == "status" {
		json.NewEncoder(c).Encode(r.status())
		return
	}
	if req.Action == "stop" {
		json.NewEncoder(c).Encode(map[string]any{"stopping": true})
		r.stop()
		return
	}
	if req.Action == "flush" {
		r.mu.Lock()
		err := r.log.Flush()
		r.mu.Unlock()
		if err != nil {
			json.NewEncoder(c).Encode(map[string]any{"error": "cannot flush log"})
		} else {
			json.NewEncoder(c).Encode(map[string]any{"flushed": true})
		}
		return
	}
	json.NewEncoder(c).Encode(map[string]any{"error": "unknown action"})
}
func run(home string) error {
	debug.SetMemoryLimit(12 * 1024 * 1024)
	debug.SetGCPercent(75)
	runtime.GOMAXPROCS(1)
	if e := os.MkdirAll(home, 0700); e != nil {
		return e
	}
	lock, e := os.OpenFile(filepath.Join(home, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer lock.Close()
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return errors.New("recorder already running")
	}
	configBytes, e := os.ReadFile(filepath.Join(home, "config.json"))
	if e != nil {
		return errors.New("missing private config")
	}
	var config Config
	if json.Unmarshal(configBytes, &config) != nil {
		return errors.New("invalid config")
	}
	if config.Address != "http://127.0.0.1:2333" || len(config.Authorization) != 64 {
		return errors.New("invalid local API config")
	}
	if _, e := hex.DecodeString(config.Authorization); e != nil {
		return errors.New("invalid authorization")
	}
	l, e := openLog(home, segmentBytes)
	if e != nil {
		return e
	}
	defer l.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	r := &Recorder{home: home, log: l, started: time.Now().UnixMilli(), stop: cancel}
	r.restore()
	socket := filepath.Join(home, "control.sock")
	os.Remove(socket)
	listener, e := net.Listen("unix", socket)
	if e != nil {
		return e
	}
	defer listener.Close()
	defer os.Remove(socket)
	if e = os.Chmod(socket, 0600); e != nil {
		return e
	}
	go func() { <-ctx.Done(); listener.Close() }()
	go func() {
		for {
			c, e := listener.Accept()
			if e != nil {
				return
			}
			go r.handle(c)
		}
	}()
	r.record("event", map[string]any{"event": "recorder_started", "version": version})
	api := &API{config: config, client: &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{Proxy: nil, MaxIdleConns: 2, IdleConnTimeout: time.Minute}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	defer api.client.CloseIdleConnections()
	samples := time.NewTicker(15 * time.Second)
	defer samples.Stop()
	flush := time.NewTicker(30 * time.Second)
	defer flush.Stop()
	probes := time.NewTimer(0)
	defer probes.Stop()
	// Sampling and probing run in separate, bounded workers, never overlapping themselves.
	sampleDone := make(chan map[string]any, 1)
	probeDone := make(chan map[string]any, 1)
	sampleRunning := false
	probeRunning := false
	startSample := func() {
		if !sampleRunning {
			sampleRunning = true
			go func() { sampleDone <- api.Sample(ctx) }()
		}
	}
	startSample()
	var unhealthySince time.Time
	for {
		select {
		case <-ctx.Done():
			r.record("event", map[string]any{"event": "recorder_stopped"})
			return nil
		case <-samples.C:
			startSample()
		case m := <-sampleDone:
			sampleRunning = false
			r.record("sample", m)
		case <-probes.C:
			if !probeRunning {
				probeRunning = true
				go func() { probeDone <- probe() }()
			}
		case m := <-probeDone:
			probeRunning = false
			r.record("probe", m)
			bad := m["icmp_state"] != "reachable" || m["dns_state"] != "resolved"
			interval := 30 * time.Second
			if bad {
				if unhealthySince.IsZero() {
					unhealthySince = time.Now()
				}
				if time.Since(unhealthySince) < 2*time.Minute {
					interval = 10 * time.Second
				}
			} else {
				unhealthySince = time.Time{}
			}
			probes.Reset(interval)
		case <-flush.C:
			r.mu.Lock()
			if e = r.log.Flush(); e != nil {
				r.logError = e.Error()
			}
			r.mu.Unlock()
		}
	}
}

func control(home, action string) error {
	c, e := net.DialTimeout("unix", filepath.Join(home, "control.sock"), 2*time.Second)
	if e != nil {
		return errors.New("recorder is stopped or unavailable")
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if e = json.NewEncoder(c).Encode(Request{action}); e != nil {
		return e
	}
	_, e = io.Copy(os.Stdout, io.LimitReader(c, 2*1024*1024))
	return e
}
func exportPlan(home string) error {
	// Include pending records, without changing a stopped collector's state.
	if c, e := net.DialTimeout("unix", filepath.Join(home, "control.sock"), time.Second); e == nil {
		c.SetDeadline(time.Now().Add(3 * time.Second))
		json.NewEncoder(c).Encode(Request{"flush"})
		var response map[string]any
		e = json.NewDecoder(c).Decode(&response)
		c.Close()
		if e != nil || response["flushed"] != true {
			return errors.New("cannot flush current records")
		}
	}
	var files []map[string]any
	for i := segmentCount - 1; i >= 0; i-- {
		name := logName(i)
		s, e := os.Stat(filepath.Join(home, name))
		if e == nil {
			files = append(files, map[string]any{"name": name, "size": s.Size(), "inode": fmt.Sprint(s.Sys().(*syscall.Stat_t).Ino)})
		}
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"files": files})
}
func exportChunk(home string, args []string) error {
	if len(args) != 4 {
		return errors.New("expected name offset size inode")
	}
	allowed := false
	for i := 0; i < segmentCount; i++ {
		if args[0] == logName(i) {
			allowed = true
		}
	}
	if !allowed {
		return errors.New("invalid log name")
	}
	offset, e := strconv.ParseInt(args[1], 10, 64)
	if e != nil {
		return e
	}
	size, e := strconv.ParseInt(args[2], 10, 64)
	if e != nil {
		return e
	}
	inode, e := strconv.ParseUint(args[3], 10, 64)
	if e != nil {
		return e
	}
	if offset < 0 || size < 0 || size > segmentBytes || offset > size {
		return errors.New("invalid log range")
	}
	f, e := os.Open(filepath.Join(home, args[0]))
	if e != nil {
		return e
	}
	defer f.Close()
	s, e := f.Stat()
	if e != nil {
		return e
	}
	// A segment may grow, but replacing it during rotation invalidates the export.
	if s.Size() < size || s.Sys().(*syscall.Stat_t).Ino != inode {
		return errors.New("log rotated; restart export")
	}
	if _, e = f.Seek(offset, io.SeekStart); e != nil {
		return e
	}
	length := min(int64(128*1024), size-offset)
	b := make([]byte, length)
	if _, e = io.ReadFull(f, b); e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"data": base64.StdEncoding.EncodeToString(b), "next": offset + length})
}
func main() {
	home := os.Getenv("UFI_BLACKBOX_HOME")
	if home == "" {
		home = defaultHome
	}
	action := "status"
	if len(os.Args) > 1 {
		action = os.Args[1]
	}
	var err error
	switch action {
	case "version":
		fmt.Println(version)
	case "serve":
		err = run(home)
	case "status", "stop":
		err = control(home, action)
	case "export-plan":
		err = exportPlan(home)
	case "export-chunk":
		err = exportChunk(home, os.Args[2:])
	default:
		err = errors.New("unknown action")
	}
	if err != nil {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"error": err.Error()})
		os.Exit(1)
	}
}
