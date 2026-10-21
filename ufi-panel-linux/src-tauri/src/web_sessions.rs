use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};

#[derive(Default)]
struct State {
    key: Option<[u8; 32]>,
    database: Option<Connection>,
    memory: HashMap<String, Value>,
}

pub struct WebSessions {
    path: PathBuf,
    state: Mutex<State>,
}
impl Default for WebSessions {
    fn default() -> Self {
        Self::new(crate::data_dir().join("web-sessions.sqlite3"))
    }
}
impl WebSessions {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(State::default()),
        }
    }
    pub fn set_key(&self, key: Option<&[u8]>) {
        self.state.lock().unwrap().key = key.and_then(|value| value.try_into().ok());
    }
    fn database<'a>(&self, state: &'a mut State) -> Result<&'a Connection, String> {
        if state.database.is_none() {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let database = Connection::open(&self.path).map_err(|e| e.to_string())?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
            database
                .busy_timeout(Duration::from_secs(2))
                .map_err(|e| e.to_string())?;
            database.execute_batch("CREATE TABLE IF NOT EXISTS web_sessions (device TEXT PRIMARY KEY, encrypted BLOB NOT NULL, updated_at INTEGER NOT NULL);").map_err(|e| e.to_string())?;
            state.database = Some(database);
        }
        Ok(state.database.as_ref().unwrap())
    }
    pub fn save(&self, device: &str, value: Value, persist: bool) -> Result<bool, String> {
        let mut state = self.state.lock().unwrap();
        state.memory.insert(device.to_string(), value.clone());
        if !persist {
            if self.path.exists() {
                self.database(&mut state)?
                    .execute("DELETE FROM web_sessions WHERE device=?1", [device])
                    .map_err(|e| e.to_string())?;
            }
            return Ok(false);
        }
        let Some(key) = state.key else {
            return Ok(false);
        };
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化网页会话加密")?;
        let nonce = rand::random::<[u8; 12]>();
        let plaintext = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: device.as_bytes(),
                },
            )
            .map_err(|_| "网页会话加密失败")?;
        let mut record = nonce.to_vec();
        record.extend(encrypted);
        self.database(&mut state)?.execute(
            "INSERT INTO web_sessions(device,encrypted,updated_at) VALUES (?1,?2,unixepoch()) ON CONFLICT(device) DO UPDATE SET encrypted=excluded.encrypted, updated_at=excluded.updated_at",
            params![device, record],
        ).map_err(|e| e.to_string())?;
        Ok(true)
    }
    pub fn load(&self, device: &str) -> Result<Option<Value>, String> {
        let mut state = self.state.lock().unwrap();
        if let Some(value) = state.memory.get(device) {
            return Ok(Some(value.clone()));
        }
        let Some(key) = state.key else {
            return Ok(None);
        };
        let record: Option<Vec<u8>> = self
            .database(&mut state)?
            .query_row(
                "SELECT encrypted FROM web_sessions WHERE device=?1",
                [device],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(record) = record.filter(|v| v.len() >= 28) else {
            return Ok(None);
        };
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化网页会话加密")?;
        let Ok(plaintext) = cipher.decrypt(
            Nonce::from_slice(&record[..12]),
            Payload {
                msg: &record[12..],
                aad: device.as_bytes(),
            },
        ) else {
            return Ok(None);
        };
        let value: Value = serde_json::from_slice(&plaintext).map_err(|_| "网页会话记录无效")?;
        state.memory.insert(device.to_string(), value.clone());
        Ok(Some(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn sqlite_restores_encrypted_sessions_and_rejects_swapped_device_records() {
        let root =
            std::env::temp_dir().join(format!("ufi-web-sessions-{:x}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("sessions.sqlite3");
        let payload =
            json!({"authorization":"private-login-token", "password":"private-zte-password"});
        let store = WebSessions::new(path.clone());
        store.set_key(Some(&[7; 32]));
        assert!(store.save("first-device", payload.clone(), true).unwrap());
        drop(store);
        let bytes = std::fs::read(&path).unwrap();
        for private in ["private-login-token", "private-zte-password"] {
            assert!(!bytes
                .windows(private.len())
                .any(|window| window == private.as_bytes()));
        }
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let store = WebSessions::new(path.clone());
        store.set_key(Some(&[7; 32]));
        assert_eq!(store.load("first-device").unwrap(), Some(payload));
        assert_eq!(store.load("another-device").unwrap(), None);
        drop(store);
        let database = Connection::open(&path).unwrap();
        database
            .execute("UPDATE web_sessions SET device='another-device'", [])
            .unwrap();
        drop(database);
        let store = WebSessions::new(path.clone());
        store.set_key(Some(&[7; 32]));
        assert_eq!(store.load("another-device").unwrap(), None);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unavailable_keyring_keeps_sessions_only_in_memory() {
        let path = std::env::temp_dir().join(format!(
            "ufi-web-sessions-{:x}.sqlite3",
            rand::random::<u64>()
        ));
        let store = WebSessions::new(path.clone());
        assert!(!store
            .save("device", json!({"password":"ephemeral"}), true)
            .unwrap());
        assert!(store.load("device").unwrap().is_some());
        assert!(!path.exists());
        drop(store);
        assert_eq!(WebSessions::new(path).load("device").unwrap(), None);
    }
    #[test]
    fn unchecking_save_credentials_removes_the_sqlite_record() {
        let root = std::env::temp_dir().join(format!(
            "ufi-web-session-forget-{:x}",
            rand::random::<u64>()
        ));
        let path = root.join("sessions.sqlite3");
        let store = WebSessions::new(path.clone());
        store.set_key(Some(&[7; 32]));
        store
            .save("device", serde_json::json!({"password":"saved"}), true)
            .unwrap();
        assert!(!store
            .save("device", serde_json::json!({"password":"in-memory"}), false)
            .unwrap());
        drop(store);
        let store = WebSessions::new(path);
        store.set_key(Some(&[7; 32]));
        assert_eq!(store.load("device").unwrap(), None);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
