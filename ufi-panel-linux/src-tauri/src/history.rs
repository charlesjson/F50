//! Local telemetry only. One bounded writer batches existing observations; readers
//! use separate WAL connections so a history query never blocks device polling.
use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

const FLUSH_AFTER: Duration = Duration::from_secs(30);
const BATCH_SIZE: usize = 128;
const CAPACITY: usize = 2048;
const METRICS: [&str; 9] = [
    "cpu",
    "memory",
    "temperature",
    "down",
    "up",
    "clients",
    "battery",
    "lteRsrp",
    "nrRsrp",
];
type Reply = Result<Value, String>;

#[derive(Default)]
struct Health {
    error: Option<String>,
    dropped: u64,
}
impl Health {
    fn message(&self) -> Option<String> {
        match (&self.error, self.dropped) {
            (None, 0) => None,
            (Some(error), 0) => Some(error.clone()),
            (error, dropped) => Some(format!(
                "{}缓存已满，{dropped} 条采样未保存",
                error.as_ref().map(|e| format!("{e}；")).unwrap_or_default()
            )),
        }
    }
}
enum Message {
    Record(Box<Record>),
    Flush(oneshot::Sender<Result<(), String>>),
    Close,
}
pub struct History {
    path: PathBuf,
    sender: mpsc::SyncSender<Message>,
    health: Arc<Mutex<Health>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl History {
    pub fn start(path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::sync_channel(CAPACITY);
        let health = Arc::new(Mutex::new(Health::default()));
        let writer_path = path.clone();
        let writer_health = health.clone();
        let thread = std::thread::spawn(move || write_loop(writer_path, receiver, writer_health));
        Self {
            path,
            sender,
            health,
            thread: Mutex::new(Some(thread)),
        }
    }
    pub fn record(&self, packet: &Value) {
        if let Some(record) = Record::from_packet(packet) {
            if self
                .sender
                .try_send(Message::Record(Box::new(record)))
                .is_err()
            {
                self.health.lock().unwrap().dropped += 1;
            }
        }
    }
    pub fn error(&self) -> Option<String> {
        self.health.lock().unwrap().message()
    }
    pub async fn request(&self, action: &str, input: Value) -> Reply {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .try_send(Message::Flush(sender))
            .map_err(|_| "历史记录队列繁忙，请稍后重试".to_string())?;
        let flush_error = receiver
            .await
            .map_err(|_| "历史记录后台已停止".to_string())?
            .err();
        let path = self.path.clone();
        let action = action.to_string();
        let error = self.error().or(flush_error);
        tauri::async_runtime::spawn_blocking(move || {
            let db = read_connection(&path)?;
            match action.as_str() {
                "history-devices" => devices(&db, &path, error),
                "history-query" => {
                    let mut result = query(&db, &input)?;
                    result["recordingError"] = json!(error);
                    Ok(result)
                }
                _ => Err("未知历史记录操作".into()),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    pub fn close(&self) {
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = self.sender.send(Message::Close);
            let _ = thread.join();
        }
    }
}

#[derive(Clone, Debug)]
struct Record {
    mode: String,
    address: String,
    name: String,
    session: String,
    sequence: i64,
    at: i64,
    interval: i64,
    valid: bool,
    values: [Option<f64>; 9],
    counters: [Option<f64>; 4],
}
fn numeric(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse().ok())
        .filter(|v| v.is_finite())
}
fn nonnegative(value: &Value) -> Option<f64> {
    numeric(value).filter(|v| *v >= 0.0)
}
fn percentage(value: &Value) -> Option<f64> {
    nonnegative(value).filter(|v| *v <= 100.0)
}
impl Record {
    fn from_packet(packet: &Value) -> Option<Self> {
        let device = &packet["device"];
        let b = &packet["snapshot"]["base"];
        let n = &packet["snapshot"]["network"];
        let temperature =
            numeric(&b["cpu_temp"]).map(|v| if v.abs() >= 1000.0 { v / 1000.0 } else { v });
        let at = packet["at"].as_i64().filter(|v| *v >= 0)?;
        Some(Self {
            mode: device["mode"].as_str()?.to_string(),
            address: device["address"].as_str()?.to_string(),
            name: device["name"].as_str().unwrap_or("设备").to_string(),
            session: packet["session"].as_str()?.to_string(),
            sequence: packet["sequence"].as_i64()?,
            at,
            interval: packet["interval"].as_i64().unwrap_or(2000),
            valid: packet["snapshot"].is_object(),
            values: [
                percentage(&b["cpu_usage"]),
                percentage(&b["mem_usage"]),
                temperature,
                nonnegative(&n["realtime_rx_thrpt"]),
                nonnegative(&n["realtime_tx_thrpt"]),
                nonnegative(&n["wifi_access_sta_num"]),
                percentage(
                    n.get("battery_vol_percent")
                        .or_else(|| n.get("battery_value"))
                        .unwrap_or(&b["battery"]),
                ),
                numeric(&n["lte_rsrp"]),
                numeric(&n["Z5g_rsrp"]),
            ],
            counters: [
                nonnegative(&b["daily_data"]),
                nonnegative(&b["monthly_data"]),
                nonnegative(&n["monthly_rx_bytes"]),
                nonnegative(&n["monthly_tx_bytes"]),
            ],
        })
    }
}

struct Database {
    connection: Connection,
}
impl Database {
    fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            options.mode(0o600);
            let file = options.open(path).map_err(|e| e.to_string())?;
            file.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        options.open(path).map_err(|e| e.to_string())?;
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err("历史数据库来自较新版本，请升级客户端后查看".into());
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY, mode TEXT NOT NULL, address TEXT NOT NULL, name TEXT NOT NULL,
                first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, sample_count INTEGER NOT NULL DEFAULT 0,
                UNIQUE(mode,address));
            CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS samples (
                device_id INTEGER NOT NULL, at INTEGER NOT NULL, session_id INTEGER NOT NULL, sequence INTEGER NOT NULL,
                interval INTEGER NOT NULL, valid INTEGER NOT NULL,
                cpu REAL, memory REAL, temperature REAL, down REAL, up REAL, clients REAL, battery REAL, lte_rsrp REAL, nr_rsrp REAL,
                daily_bytes REAL, monthly_bytes REAL, monthly_rx REAL, monthly_tx REAL,
                PRIMARY KEY(device_id,at,session_id,sequence)) WITHOUT ROWID;
            PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }
    fn write(&mut self, records: &[Record]) -> Result<(), String> {
        if records.is_empty() {
            return Ok(());
        }
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        let mut ids = HashMap::new();
        let mut sessions = HashMap::new();
        {
            let mut insert = transaction
                .prepare_cached(
                    "INSERT OR IGNORE INTO samples VALUES
                (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                )
                .map_err(|e| e.to_string())?;
            let mut update = transaction
                .prepare_cached(
                    "UPDATE devices SET first_at=MIN(first_at,?1),
                last_at=MAX(last_at,?1),sample_count=sample_count+?2 WHERE id=?3",
                )
                .map_err(|e| e.to_string())?;
            for r in records {
                let key = (&r.mode, &r.address);
                let id = if let Some(id) = ids.get(&key) {
                    *id
                } else {
                    transaction.execute("INSERT INTO devices(mode,address,name,first_at,last_at) VALUES(?1,?2,?3,?4,?4)
                        ON CONFLICT(mode,address) DO UPDATE SET name=excluded.name",
                        params![r.mode, r.address, r.name, r.at]).map_err(|e| e.to_string())?;
                    let id: i64 = transaction
                        .query_row(
                            "SELECT id FROM devices WHERE mode=?1 AND address=?2",
                            params![r.mode, r.address],
                            |row| row.get(0),
                        )
                        .map_err(|e| e.to_string())?;
                    ids.insert(key, id);
                    id
                };
                let session_id = if let Some(id) = sessions.get(&r.session) {
                    *id
                } else {
                    transaction
                        .execute(
                            "INSERT OR IGNORE INTO sessions(token) VALUES(?1)",
                            [&r.session],
                        )
                        .map_err(|e| e.to_string())?;
                    let id: i64 = transaction
                        .query_row(
                            "SELECT id FROM sessions WHERE token=?1",
                            [&r.session],
                            |row| row.get(0),
                        )
                        .map_err(|e| e.to_string())?;
                    sessions.insert(&r.session, id);
                    id
                };
                let v = &r.values;
                let c = &r.counters;
                let changed = insert
                    .execute(params![
                        id, r.at, session_id, r.sequence, r.interval, r.valid, v[0], v[1], v[2],
                        v[3], v[4], v[5], v[6], v[7], v[8], c[0], c[1], c[2], c[3]
                    ])
                    .map_err(|e| e.to_string())?;
                update
                    .execute(params![r.at, changed as i64, id])
                    .map_err(|e| e.to_string())?;
            }
        }
        transaction.commit().map_err(|e| e.to_string())
    }
}
fn write_loop(path: PathBuf, receiver: mpsc::Receiver<Message>, health: Arc<Mutex<Health>>) {
    let mut database = Database::open(&path);
    health.lock().unwrap().error = database.as_ref().err().cloned();
    let mut pending = Vec::new();
    let mut flushed = Instant::now();
    loop {
        let message = receiver.recv_timeout(FLUSH_AFTER.saturating_sub(flushed.elapsed()));
        let (reply, closing, force) = match message {
            Ok(Message::Record(record)) => {
                if pending.len() < CAPACITY {
                    pending.push(*record);
                } else {
                    health.lock().unwrap().dropped += 1;
                }
                (None, false, false)
            }
            Ok(Message::Flush(reply)) => (Some(reply), false, true),
            Ok(Message::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => (None, true, true),
            Err(mpsc::RecvTimeoutError::Timeout) => (None, false, true),
        };
        if force
            || (pending.len() >= BATCH_SIZE && health.lock().unwrap().error.is_none())
            || flushed.elapsed() >= FLUSH_AFTER
        {
            if database.is_err() {
                database = Database::open(&path);
            }
            let result = match &mut database {
                Ok(db) => db.write(&pending),
                Err(error) => Err(error.clone()),
            };
            health.lock().unwrap().error = result.as_ref().err().cloned();
            if result.is_ok() {
                pending.clear();
            }
            if let Some(reply) = reply {
                let _ = reply.send(result);
            }
            flushed = Instant::now();
        }
        if closing {
            break;
        }
    }
}
fn read_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch("PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;")
        .map_err(|e| e.to_string())?;
    Ok(connection)
}
fn devices(connection: &Connection, path: &Path, error: Option<String>) -> Reply {
    let mut statement = connection.prepare("SELECT id,mode,address,name,first_at,last_at,sample_count FROM devices ORDER BY last_at DESC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |r| {
            Ok(json!({"id":r.get::<_,i64>(0)?,"mode":r.get::<_,String>(1)?,
        "address":r.get::<_,String>(2)?,"name":r.get::<_,String>(3)?,"firstAt":r.get::<_,i64>(4)?,
        "lastAt":r.get::<_,i64>(5)?,"count":r.get::<_,i64>(6)?}))
        })
        .map_err(|e| e.to_string())?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let bytes: u64 = [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
    ]
    .iter()
    .filter_map(|p| fs::metadata(p).ok())
    .map(|m| m.len())
    .sum();
    Ok(json!({"devices":items,"databaseBytes":bytes,"path":path,"error":error}))
}

#[derive(Clone, Copy, Default)]
struct Metric {
    count: usize,
    sum: f64,
    min: Option<f64>,
    max: Option<f64>,
}
impl Metric {
    fn add(&mut self, value: Option<f64>) {
        if let Some(v) = value {
            self.count += 1;
            self.sum += v;
            self.min = Some(self.min.map_or(v, |n| n.min(v)));
            self.max = Some(self.max.map_or(v, |n| n.max(v)));
        }
    }
    fn average(&self) -> Option<f64> {
        (self.count > 0).then(|| self.sum / self.count as f64)
    }
    fn json(&self) -> Value {
        json!({"average":self.average(),"min":self.min,"max":self.max,"count":self.count})
    }
}
#[derive(Default)]
struct Aggregate {
    count: usize,
    failures: usize,
    first: i64,
    last: i64,
    gap: bool,
    internal_gap: bool,
    metrics: [Metric; 9],
    counters: [Option<f64>; 4],
}
impl Aggregate {
    fn add(
        &mut self,
        at: i64,
        valid: bool,
        gap: bool,
        values: &[Option<f64>; 9],
        counters: [Option<f64>; 4],
    ) {
        self.internal_gap |= self.count > 0 && gap;
        if self.count == 0 {
            self.first = at;
        }
        self.count += 1;
        self.last = at;
        self.failures += usize::from(!valid);
        self.gap |= gap;
        for (metric, value) in self.metrics.iter_mut().zip(values) {
            metric.add(*value);
        }
        // Counters are snapshots, never sums. Keep missing latest readings missing.
        self.counters = counters;
    }
    fn point(&self) -> Value {
        let mut result = json!({"at":self.first+(self.last-self.first)/2,"firstAt":self.first,"lastAt":self.last,
            "count":self.count,"failures":self.failures,"breakBefore":self.gap,"breakAfter":self.internal_gap,
            "dailyBytes":self.counters[0],"monthlyBytes":self.counters[1],"monthlyRx":self.counters[2],"monthlyTx":self.counters[3]});
        for (key, metric) in METRICS.iter().zip(self.metrics) {
            result[*key] = json!(metric.average());
            result[format!("{key}Min")] = json!(metric.min);
            result[format!("{key}Max")] = json!(metric.max);
            result[format!("{key}Gaps")] = json!(metric.count > 0 && metric.count < self.count);
        }
        result
    }
    fn summary(&self) -> Value {
        let mut result = json!({"count":self.count,"failures":self.failures,
            "firstAt":if self.count>0{Some(self.first)}else{None},"lastAt":if self.count>0{Some(self.last)}else{None},
            "dailyBytes":self.counters[0],"monthlyBytes":self.counters[1],"monthlyRx":self.counters[2],"monthlyTx":self.counters[3]});
        for (key, metric) in METRICS.iter().zip(self.metrics) {
            result[*key] = metric.json();
        }
        result
    }
}
fn query(connection: &Connection, input: &Value) -> Reply {
    let id = input["deviceId"]
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or("请选择历史设备")?;
    let from = input["from"]
        .as_i64()
        .filter(|n| *n >= 0)
        .ok_or("无效开始时间")?;
    let to = input["to"]
        .as_i64()
        .filter(|n| *n <= 8_640_000_000_000_000 && *n > from)
        .ok_or("结束时间必须晚于开始时间")?;
    let raw = input["raw"].as_bool().unwrap_or(false);
    let step = ((to - from + 999) / 1000).max(1000);
    let mut statement = connection.prepare("SELECT at,session_id,interval,valid,cpu,memory,temperature,down,up,
        clients,battery,lte_rsrp,nr_rsrp,daily_bytes,monthly_bytes,monthly_rx,monthly_tx FROM samples
        WHERE device_id=?1 AND at>=?2 AND at<?3 ORDER BY at,session_id,sequence").map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![id, from, to])
        .map_err(|e| e.to_string())?;
    let mut points = Vec::new();
    let mut summary = Aggregate::default();
    let mut bucket = Aggregate::default();
    let mut bucket_id = None;
    let mut previous: Option<(i64, i64, i64, bool)> = None;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let at: i64 = row.get(0).map_err(|e| e.to_string())?;
        let session: i64 = row.get(1).map_err(|e| e.to_string())?;
        let interval: i64 = row.get(2).map_err(|e| e.to_string())?;
        let valid: bool = row.get(3).map_err(|e| e.to_string())?;
        let gap = !valid
            || previous
                .is_some_and(|(p, s, i, ok)| s != session || !ok || at - p > 5000.max(i * 5 / 2));
        previous = Some((at, session, interval, valid));
        let mut values = [None; 9];
        let mut counters = [None; 4];
        for (i, value) in values.iter_mut().enumerate() {
            *value = row.get(i + 4).map_err(|e| e.to_string())?;
        }
        for (i, value) in counters.iter_mut().enumerate() {
            *value = row.get(i + 13).map_err(|e| e.to_string())?;
        }
        let index = if raw {
            summary.count as i64
        } else {
            (at - from) / step
        };
        if bucket_id.is_some_and(|b| b != index) {
            points.push(bucket.point());
            bucket = Aggregate::default();
        }
        bucket_id = Some(index);
        bucket.add(at, valid, gap, &values, counters);
        summary.add(at, valid, gap, &values, counters);
        if raw && summary.count > 5000 {
            return Err("此范围超过 5000 条原始采样，请缩小时间范围或选择自动汇总".into());
        }
    }
    if bucket.count > 0 {
        points.push(bucket.point());
    }
    Ok(
        json!({"from":from,"to":to,"resolutionMs":if raw{0}else{step},"points":points,"summary":summary.summary()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "ufi-history-{:016x}/telemetry.sqlite3",
                rand::random::<u64>()
            )))
        }
        fn db(&self) -> Database {
            Database::open(&self.0).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(self.0.parent().unwrap());
        }
    }
    fn packet(at: i64, sequence: i64) -> Value {
        json!({"at":at,"sequence":sequence,"session":"test-session","interval":2000,
            "device":{"mode":"KANO","address":"http://192.168.0.1:2333","name":"F50"},
            "snapshot":{"base":{"cpu_usage":"0","mem_usage":"42.5","cpu_temp":"52100","daily_data":"1000","monthly_data":"12000"},
                "network":{"realtime_rx_thrpt":"0","realtime_tx_thrpt":"2048","wifi_access_sta_num":"3","monthly_rx_bytes":"10000","monthly_tx_bytes":"2000"}}})
    }
    fn record(at: i64, sequence: i64) -> Record {
        Record::from_packet(&packet(at, sequence)).unwrap()
    }
    fn range(from: i64, to: i64) -> Value {
        json!({"deviceId":1,"from":from,"to":to})
    }

    #[test]
    fn normalizes_missing_values_and_retains_real_zeroes_without_storing_secrets() {
        let mut p = packet(1000, 1);
        p["snapshot"]["base"]["mem_usage"] = json!("");
        p["snapshot"]["network"]["realtime_tx_thrpt"] = json!(-1);
        p["snapshot"]["network"]["imei"] = json!("not-a-metric");
        p["device"]["password"] = json!("private-secret");
        let r = Record::from_packet(&p).unwrap();
        assert_eq!(
            r.values[..5],
            [Some(0.0), None, Some(52.1), Some(0.0), None]
        );
        let fixture = Fixture::new();
        let mut db = fixture.db();
        db.write(&[r]).unwrap();
        drop(db);
        let bytes = fs::read(&fixture.0).unwrap();
        for forbidden in ["private-secret", "not-a-metric"] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|w| w == forbidden.as_bytes()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&fixture.0).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn persists_across_restart_isolates_devices_and_deduplicates_replayed_samples() {
        let fixture = Fixture::new();
        let mut db = fixture.db();
        let one = record(1000, 1);
        let mut two = record(3000, 2);
        two.address = "http://192.168.1.1:2333".into();
        two.name = "另一个设备".into();
        db.write(&[one.clone(), one, two]).unwrap();
        drop(db);
        let db = fixture.db();
        let saved = devices(&db.connection, &fixture.0, None).unwrap();
        assert_eq!(saved["devices"].as_array().unwrap().len(), 2);
        assert_eq!(saved["devices"][0]["count"], 1);
        let result = query(&db.connection, &range(0, 4000)).unwrap();
        assert_eq!(result["summary"]["count"], 1);
        assert_eq!(result["summary"]["firstAt"], 1000);
        let index: String = db.connection.query_row("EXPLAIN QUERY PLAN SELECT at FROM samples WHERE device_id=1 AND at>=0 AND at<4000 ORDER BY at",[],|r|r.get(3)).unwrap();
        assert!(index.contains("PRIMARY KEY"), "{index}");
    }

    #[test]
    fn aggregates_weighted_readings_and_exact_peaks_but_never_sums_cumulative_traffic() {
        let fixture = Fixture::new();
        let mut db = fixture.db();
        let mut a = record(1000, 1);
        a.values[0] = Some(10.0);
        a.counters[0] = Some(2000.0);
        let mut b = record(3000, 2);
        b.values[0] = Some(90.0);
        b.counters[0] = Some(3000.0);
        let mut c = record(5000, 3);
        c.values[0] = None;
        c.counters[0] = Some(10.0);
        c.counters[1] = Some(10.0);
        db.write(&[a, b, c]).unwrap();
        let result = query(&db.connection, &range(0, 10_000_000)).unwrap();
        assert_eq!(result["points"].as_array().unwrap().len(), 1);
        assert_eq!(result["points"][0]["cpu"], 50.0);
        assert_eq!(result["points"][0]["cpuGaps"], true);
        assert_eq!(result["summary"]["cpu"]["average"], 50.0);
        assert_eq!(result["summary"]["cpu"]["max"], 90.0);
        assert_eq!(result["summary"]["dailyBytes"], 10.0);
        assert_eq!(result["points"][0]["monthlyBytes"], 10.0);
        assert_eq!(
            query(&db.connection, &range(1000, 5000)).unwrap()["summary"]["count"],
            2
        );
    }

    #[test]
    fn failed_reads_pauses_and_reconnections_split_lines_and_do_not_invent_zeroes() {
        let fixture = Fixture::new();
        let mut db = fixture.db();
        let mut failed = packet(3000, 2);
        failed["snapshot"] = Value::Null;
        failed["error"] = json!("offline");
        let mut reconnect = record(25_000, 5);
        reconnect.session = "another-session".into();
        db.write(&[
            record(1000, 1),
            Record::from_packet(&failed).unwrap(),
            record(5000, 3),
            record(20_000, 4),
            reconnect,
        ])
        .unwrap();
        let mut input = range(0, 30_000);
        input["raw"] = json!(true);
        let result = query(&db.connection, &input).unwrap();
        let points = result["points"].as_array().unwrap();
        assert_eq!(result["summary"]["failures"], 1);
        assert!(points[1]["cpu"].is_null());
        assert!(points[1]["dailyBytes"].is_null());
        assert_eq!(
            points
                .iter()
                .map(|p| p["breakBefore"].as_bool().unwrap())
                .collect::<Vec<_>>(),
            [false, true, true, true, true]
        );
        let grouped = query(&db.connection, &range(0, 30_000_000)).unwrap();
        assert_eq!(grouped["points"][0]["breakBefore"], true);
        assert_eq!(grouped["points"][0]["breakAfter"], true);
    }

    #[test]
    fn queries_bound_output_reject_bad_ranges_and_allow_concurrent_wal_writes() {
        let fixture = Fixture::new();
        let mut db = fixture.db();
        let records = (0..5001)
            .map(|i| record(1000 + i * 2000, i + 1))
            .collect::<Vec<_>>();
        db.write(&records).unwrap();
        let reader = read_connection(&fixture.0).unwrap();
        let mut statement = reader.prepare("SELECT at FROM samples").unwrap();
        let mut rows = statement.query([]).unwrap();
        rows.next().unwrap();
        db.write(&[record(10_100_000, 6000)]).unwrap();
        drop(rows);
        drop(statement);
        let input = range(0, 11_000_000);
        let result = query(&reader, &input).unwrap();
        assert_eq!(result["summary"]["count"], 5002);
        assert!(result["points"].as_array().unwrap().len() <= 1000);
        let mut raw = input;
        raw["raw"] = json!(true);
        assert!(query(&reader, &raw).unwrap_err().contains("5000"));
        assert!(query(&reader, &range(100, 100)).is_err());
        assert!(query(&reader, &range(-1, 100)).is_err());
        assert_eq!(
            query(&reader, &range(20_000_000, 21_000_000)).unwrap()["summary"]["count"],
            0
        );
    }

    #[test]
    fn writer_flushes_partial_batches_on_read_and_exit_and_recovers_from_open_errors() {
        let fixture = Fixture::new();
        let history = History::start(fixture.0.clone());
        history.record(&packet(1000, 1));
        let (tx, rx) = oneshot::channel();
        history.sender.send(Message::Flush(tx)).unwrap();
        rx.blocking_recv().unwrap().unwrap();
        assert_eq!(
            query(&read_connection(&fixture.0).unwrap(), &range(0, 4000)).unwrap()["summary"]
                ["count"],
            1
        );
        history.record(&packet(3000, 2));
        history.close();
        assert_eq!(
            query(&read_connection(&fixture.0).unwrap(), &range(0, 4000)).unwrap()["summary"]
                ["count"],
            2
        );

        let broken = Fixture::new();
        fs::create_dir_all(&broken.0).unwrap();
        let history = History::start(broken.0.clone());
        history.record(&packet(1000, 1));
        let (tx, rx) = oneshot::channel();
        history.sender.send(Message::Flush(tx)).unwrap();
        assert!(rx.blocking_recv().unwrap().is_err());
        assert!(history.error().is_some());
        fs::remove_dir(&broken.0).unwrap();
        let (tx, rx) = oneshot::channel();
        history.sender.send(Message::Flush(tx)).unwrap();
        rx.blocking_recv().unwrap().unwrap();
        assert!(history.error().is_none());
        history.close();
        assert_eq!(
            query(&read_connection(&broken.0).unwrap(), &range(0, 4000)).unwrap()["summary"]
                ["count"],
            1
        );
    }

    #[test]
    #[ignore = "30 days of synthetic 2-second telemetry; run explicitly for performance measurements"]
    fn benchmark_history() {
        let fixture = Fixture::new();
        let mut db = fixture.db();
        let count: i64 = 30 * 24 * 60 * 30;
        let mut elapsed = Vec::new();
        let start = Instant::now();
        for batch in 0..count / 15 {
            let records = (0..15)
                .map(|i| {
                    let n = batch * 15 + i;
                    let mut r = record(1_700_000_000_000 + n * 2000, n + 1);
                    r.values = [
                        Some((n % 100) as f64),
                        Some(42.5 + (n % 17) as f64 / 10.0),
                        Some(48.0 + (n % 80) as f64 / 10.0),
                        Some((n * 7919 % 40_000_000) as f64),
                        Some((n * 2179 % 4_000_000) as f64),
                        Some(3.0),
                        Some(85.0),
                        Some(-83.0),
                        Some(-91.0),
                    ];
                    r.counters = [
                        Some((n % 43200 * 40000) as f64),
                        Some((n * 40000) as f64),
                        Some((n * 35000) as f64),
                        Some((n * 5000) as f64),
                    ];
                    r
                })
                .collect::<Vec<_>>();
            let batch_start = Instant::now();
            db.write(&records).unwrap();
            elapsed.push(batch_start.elapsed().as_secs_f64() * 1000.0);
        }
        let write_seconds = start.elapsed().as_secs_f64();
        elapsed.sort_by(|a, b| a.total_cmp(b));
        db.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        let bytes = fs::metadata(&fixture.0).unwrap().len();
        let reader = read_connection(&fixture.0).unwrap();
        let end = 1_700_000_000_000 + count * 2000;
        let mut times = Vec::new();
        for days in [1, 7, 30] {
            let start = Instant::now();
            let result = query(&reader, &range(end - days * 86400000, end)).unwrap();
            times.push(json!({"days":days,"milliseconds":start.elapsed().as_secs_f64()*1000.0,"points":result["points"].as_array().unwrap().len(),"samples":result["summary"]["count"]}));
        }
        println!(
            "HISTORY_BENCHMARK {}",
            json!({"build":if cfg!(debug_assertions){"debug"}else{"release"},"sqlite":rusqlite::version(),
            "samples":count,"days":30,"intervalMs":2000,"batchSamples":15,"databaseBytes":bytes,"bytesPerDay":bytes/30,
            "writeSeconds":write_seconds,"batchMedianMs":elapsed[elapsed.len()/2],"batchP95Ms":elapsed[elapsed.len()*95/100],"queries":times})
        );
    }
}
