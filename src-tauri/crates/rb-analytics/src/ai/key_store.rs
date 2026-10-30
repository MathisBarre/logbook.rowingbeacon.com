//! The AI keys, in the system keychain with a file fallback (plan 2.13,
//! ADR 0008 "AI providers"). Never logged, never returned to the webview,
//! never written to `main.db`, so backups, restores, efa2 and CSV exports
//! cannot hold them.
//!
//! One entry per provider, each in its own keychain account and file:
//!
//! | Provider            | Keychain account               | Holds                         |
//! |---------------------|--------------------------------|-------------------------------|
//! | `anthropic`         | `anthropic-api-key`            | the key (`sk-ant-…`)          |
//! | `openai`            | `openai-api-key`               | the key (`sk-…`)              |
//! | `openai_compatible` | `openai-compatible-connection` | `{"baseUrl", "key"}` as JSON  |
//!
//! The compatible server's address is saved with its key, so the webview
//! never chooses where a key goes: a question only names the provider.
//!
//! - `KeyringStore`: macOS Keychain, Windows Credential Manager, Secret
//!   Service on Linux (`keyring` 4, `v1` API).
//! - `FileStore`: `<config>/<identifier>/secrets/<account>`, mode `0600` in
//!   a `0700` folder on Unix; on Windows the per-user profile ACL applies.
//!   Used when no keychain is reachable, typically a Raspberry Pi kiosk
//!   without a Secret Service.
//!
//! `set` tries the keychain and falls back to the file on any error;
//! `get` reads the keychain, then the file; `delete` clears both. Keychain
//! errors are reported by kind only: some `keyring` errors carry the
//! secret's bytes (`BadEncoding`), so they are never formatted.

use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::base_url::BaseUrl;
use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{AiProvider, KeyStatus, KeyStorage};

/// Keychain service of every key.
pub const KEYRING_SERVICE: &str = crate::paths::APP_IDENTIFIER;
/// Anthropic's keychain account (and file name), as before providers.
pub const KEYRING_ACCOUNT: &str = "anthropic-api-key";
pub const OPENAI_KEYRING_ACCOUNT: &str = "openai-api-key";
pub const COMPATIBLE_KEYRING_ACCOUNT: &str = "openai-compatible-connection";

pub const KEY_PREFIX: &str = "sk-ant-";
pub const KEY_MIN_LEN: usize = 20;
pub const KEY_MAX_LEN: usize = 300;
pub const OPENAI_KEY_PREFIX: &str = "sk-";
pub const OPENAI_KEY_MAX_LEN: usize = 500;
/// A compatible server's key has no known prefix.
pub const COMPATIBLE_KEY_MIN_LEN: usize = 8;
pub const COMPATIBLE_KEY_MAX_LEN: usize = 1000;

/// Keychain account (and file name) of a provider.
pub fn account(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Anthropic => KEYRING_ACCOUNT,
        AiProvider::OpenAi => OPENAI_KEYRING_ACCOUNT,
        AiProvider::OpenAiCompatible => COMPATIBLE_KEYRING_ACCOUNT,
    }
}

fn invalid_key(message: impl Into<String>) -> AnalyticsError {
    AnalyticsError::new(ErrorCode::InvalidKey, message)
}

/// An API key. `Debug` hides it and there is no `Display`: the value only
/// leaves through `expose`, for the request header.
#[derive(Clone, PartialEq, Eq)]
pub struct ApiKey(String);

impl ApiKey {
    /// An Anthropic key: trimmed, starts with `sk-ant-`, 20-300
    /// characters, printable ASCII without spaces (it goes into an HTTP
    /// header).
    pub fn parse(raw: &str) -> Result<ApiKey, AnalyticsError> {
        ApiKey::parse_for(AiProvider::Anthropic, raw)
    }

    /// The key rules of a provider. No message echoes what was typed.
    ///
    /// - Anthropic: `sk-ant-`, 20-300 characters;
    /// - OpenAI: `sk-` (`sk-proj-…`, `sk-svcacct-…`) but not `sk-ant-`,
    ///   20-500 characters;
    /// - compatible: any prefix, 8-1000 characters.
    pub fn parse_for(provider: AiProvider, raw: &str) -> Result<ApiKey, AnalyticsError> {
        let key = raw.trim();
        let len = key.chars().count();
        let (min, max) = match provider {
            AiProvider::Anthropic => {
                if !key.starts_with(KEY_PREFIX) {
                    return Err(invalid_key(format!(
                        "An Anthropic API key starts with {KEY_PREFIX}"
                    )));
                }
                (KEY_MIN_LEN, KEY_MAX_LEN)
            }
            AiProvider::OpenAi => {
                if key.starts_with(KEY_PREFIX) {
                    return Err(invalid_key(
                        "This is an Anthropic key: choose Anthropic as the provider",
                    ));
                }
                if !key.starts_with(OPENAI_KEY_PREFIX) {
                    return Err(invalid_key(format!(
                        "An OpenAI API key starts with {OPENAI_KEY_PREFIX}"
                    )));
                }
                (KEY_MIN_LEN, OPENAI_KEY_MAX_LEN)
            }
            AiProvider::OpenAiCompatible => (COMPATIBLE_KEY_MIN_LEN, COMPATIBLE_KEY_MAX_LEN),
        };
        if !(min..=max).contains(&len) {
            return Err(invalid_key(format!(
                "An API key for {} has {min} to {max} characters",
                provider.label()
            )));
        }
        if !key.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(invalid_key(
                "The API key contains spaces or characters that are not allowed",
            ));
        }
        Ok(ApiKey(key.to_string()))
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }

    /// The last 4 characters, to tell keys apart in the settings ("…AbCd").
    /// None for a key too short to keep most of it hidden (under 12).
    pub fn hint(&self) -> Option<String> {
        let chars: Vec<char> = self.0.chars().collect();
        (chars.len() >= 12).then(|| chars[chars.len() - 4..].iter().collect())
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(<hidden>)")
    }
}

/// What a store holds, as text: a key, or the compatible connection as
/// JSON. Hidden like a key.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub(crate) fn new(text: impl Into<String>) -> Self {
        Secret(text.into())
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<hidden>)")
    }
}

/// The server and key of `openai_compatible`; the key is optional (a
/// local Ollama or LM Studio needs none).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibleConnection {
    pub base_url: BaseUrl,
    pub key: Option<ApiKey>,
}

/// What a provider needs to answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    Anthropic(ApiKey),
    OpenAi(ApiKey),
    Compatible(CompatibleConnection),
}

impl Credential {
    pub fn provider(&self) -> AiProvider {
        match self {
            Credential::Anthropic(_) => AiProvider::Anthropic,
            Credential::OpenAi(_) => AiProvider::OpenAi,
            Credential::Compatible(_) => AiProvider::OpenAiCompatible,
        }
    }

    /// The stored text.
    fn to_secret(&self) -> Secret {
        match self {
            Credential::Anthropic(key) | Credential::OpenAi(key) => Secret::new(key.expose()),
            Credential::Compatible(connection) => Secret::new(
                json!({
                    "baseUrl": connection.base_url.as_str(),
                    "key": connection.key.as_ref().map(ApiKey::expose),
                })
                .to_string(),
            ),
        }
    }

    /// Reads a stored text; anything invalid reads as nothing stored.
    fn from_secret(provider: AiProvider, secret: &Secret) -> Option<Credential> {
        let text = secret.expose().trim();
        match provider {
            AiProvider::Anthropic => ApiKey::parse_for(provider, text)
                .ok()
                .map(Credential::Anthropic),
            AiProvider::OpenAi => ApiKey::parse_for(provider, text)
                .ok()
                .map(Credential::OpenAi),
            AiProvider::OpenAiCompatible => {
                let value: Value = serde_json::from_str(text).ok()?;
                let base_url = BaseUrl::parse(value.get("baseUrl")?.as_str()?).ok()?;
                let key = match value.get("key") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(key)) => Some(ApiKey::parse_for(provider, key).ok()?),
                    Some(_) => return None,
                };
                Some(Credential::Compatible(CompatibleConnection {
                    base_url,
                    key,
                }))
            }
        }
    }

    /// Checks what the user typed. `base_url` is for the compatible
    /// provider only (required there), and its key may be empty.
    pub fn parse(
        provider: AiProvider,
        key: &str,
        base_url: Option<&str>,
    ) -> Result<Credential, AnalyticsError> {
        match provider {
            AiProvider::Anthropic => Ok(Credential::Anthropic(ApiKey::parse_for(provider, key)?)),
            AiProvider::OpenAi => Ok(Credential::OpenAi(ApiKey::parse_for(provider, key)?)),
            AiProvider::OpenAiCompatible => {
                let base_url = BaseUrl::parse(base_url.unwrap_or(""))?;
                let key = match key.trim() {
                    "" => None,
                    key => Some(ApiKey::parse_for(provider, key)?),
                };
                Ok(Credential::Compatible(CompatibleConnection {
                    base_url,
                    key,
                }))
            }
        }
    }

    fn status(&self, storage: KeyStorage) -> KeyStatus {
        let mut status = KeyStatus::stored(storage);
        let key = match self {
            Credential::Anthropic(key) | Credential::OpenAi(key) => Some(key),
            Credential::Compatible(connection) => {
                status.base_url = Some(connection.base_url.as_str().to_string());
                status.has_key = Some(connection.key.is_some());
                connection.key.as_ref()
            }
        };
        status.hint = key.and_then(ApiKey::hint);
        status
    }
}

/// Error of a store, without any secret material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// One place where a secret can live.
pub trait KeyStore {
    fn kind(&self) -> KeyStorage;
    /// `Ok(None)` when nothing is stored.
    fn get(&self) -> Result<Option<Secret>, StoreError>;
    fn set(&self, secret: &Secret) -> Result<(), StoreError>;
    /// Deleting a missing key succeeds.
    fn delete(&self) -> Result<(), StoreError>;
}

// ------------------------------------------------------------------ keyring

/// The system keychain (`keyring::Entry::new(APP_IDENTIFIER, account)`).
#[derive(Debug, Clone)]
pub struct KeyringStore {
    service: String,
    account: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        KeyringStore {
            service: KEYRING_SERVICE.to_string(),
            account: KEYRING_ACCOUNT.to_string(),
        }
    }
}

impl KeyringStore {
    /// The entry of a provider.
    pub fn for_provider(provider: AiProvider) -> Self {
        KeyringStore::with_entry(KEYRING_SERVICE, account(provider))
    }

    /// Another entry (tests use their own account name).
    pub fn with_entry(service: &str, account: &str) -> Self {
        KeyringStore {
            service: service.to_string(),
            account: account.to_string(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, StoreError> {
        keyring::Entry::new(&self.service, &self.account).map_err(keyring_error)
    }
}

/// The kind of a keyring error, never its payload.
fn keyring_error(error: keyring::Error) -> StoreError {
    let kind = match error {
        keyring::Error::PlatformFailure(_) => "platform failure",
        keyring::Error::NoStorageAccess(_) => "no access to the credential store",
        keyring::Error::NoEntry => "no entry",
        keyring::Error::BadEncoding(_) => "stored value is not text",
        keyring::Error::BadDataFormat(_, _) => "stored value has a bad format",
        keyring::Error::BadStoreFormat(_) => "credential store has a bad format",
        keyring::Error::TooLong(_, _) => "value too long for the credential store",
        keyring::Error::Invalid(_, _) => "invalid credential attributes",
        keyring::Error::Ambiguous(_) => "several matching credentials",
        keyring::Error::NoDefaultStore => "no credential store on this system",
        _ => "credential store error",
    };
    StoreError(format!("keychain: {kind}"))
}

impl KeyStore for KeyringStore {
    fn kind(&self) -> KeyStorage {
        KeyStorage::Keychain
    }

    fn get(&self) -> Result<Option<Secret>, StoreError> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(Secret::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn set(&self, key: &Secret) -> Result<(), StoreError> {
        let entry = self.entry()?;
        entry.set_password(key.expose()).map_err(keyring_error)?;
        // Some stores accept a write they cannot read back (a locked
        // Secret Service collection): only a read-back counts.
        match entry.get_password() {
            Ok(value) if value == key.expose() => Ok(()),
            Ok(_) => Err(StoreError("keychain: read-back mismatch".into())),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn delete(&self) -> Result<(), StoreError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

// --------------------------------------------------------------------- file

/// A text file only the user can read.
#[derive(Debug, Clone)]
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        FileStore { path: path.into() }
    }

    /// `paths::key_file_path()` (Anthropic).
    pub fn default_location() -> Result<Self, AnalyticsError> {
        FileStore::for_provider(AiProvider::Anthropic)
    }

    /// `<config>/<identifier>/secrets/<account>`.
    pub fn for_provider(provider: AiProvider) -> Result<Self, AnalyticsError> {
        Ok(FileStore::new(crate::paths::secret_file_path(account(
            provider,
        ))?))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn io_error(what: &str, error: io::Error) -> StoreError {
    StoreError(format!("key file: {what}: {}", error.kind()))
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    // An existing folder keeps its mode unless we tighten it.
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

#[cfg(unix)]
fn open_private_file(path: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn open_private_file(path: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
}

impl KeyStore for FileStore {
    fn kind(&self) -> KeyStorage {
        KeyStorage::File
    }

    fn get(&self) -> Result<Option<Secret>, StoreError> {
        match fs::read_to_string(&self.path) {
            Ok(text) => Ok(Some(Secret::new(text.trim_end_matches(['\n', '\r'])))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error("read", error)),
        }
    }

    /// Writes `<file>.tmp` (0600) then renames it, so a crash never leaves
    /// half a key.
    fn set(&self, key: &Secret) -> Result<(), StoreError> {
        let dir = self
            .path
            .parent()
            .ok_or_else(|| StoreError("key file: no parent folder".into()))?;
        create_private_dir(dir).map_err(|e| io_error("create folder", e))?;
        let mut tmp = self.path.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        let written = (|| {
            let mut file = open_private_file(&tmp)?;
            file.write_all(key.expose().as_bytes())?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp, &self.path)
        })();
        if let Err(error) = written {
            let _ = fs::remove_file(&tmp);
            return Err(io_error("write", error));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
                .map_err(|e| io_error("chmod", e))?;
        }
        Ok(())
    }

    fn delete(&self) -> Result<(), StoreError> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error("delete", error)),
        }
    }
}

// ---------------------------------------------------------------- composite

/// The keychain first, the file as a fallback, for one provider.
pub struct LayeredStore<P: KeyStore, F: KeyStore> {
    pub primary: P,
    pub fallback: F,
    pub provider: AiProvider,
}

impl<P: KeyStore, F: KeyStore> LayeredStore<P, F> {
    /// The Anthropic entry.
    pub fn new(primary: P, fallback: F) -> Self {
        LayeredStore::for_provider(AiProvider::Anthropic, primary, fallback)
    }

    pub fn for_provider(provider: AiProvider, primary: P, fallback: F) -> Self {
        LayeredStore {
            primary,
            fallback,
            provider,
        }
    }

    fn read(&self, store: &dyn KeyStore) -> Result<Option<Credential>, StoreError> {
        Ok(store
            .get()?
            .and_then(|secret| Credential::from_secret(self.provider, &secret)))
    }

    /// The stored credential and where it was found. A failing keychain is
    /// skipped (the file may hold what it could not store); an invalid
    /// value reads as nothing stored.
    pub fn get(&self) -> Result<Option<(Credential, KeyStorage)>, AnalyticsError> {
        if let Ok(Some(credential)) = self.read(&self.primary) {
            return Ok(Some((credential, self.primary.kind())));
        }
        match self.read(&self.fallback) {
            Ok(Some(credential)) => Ok(Some((credential, self.fallback.kind()))),
            Ok(None) => Ok(None),
            Err(error) => Err(AnalyticsError::internal(error.to_string())),
        }
    }

    pub fn status(&self) -> Result<KeyStatus, AnalyticsError> {
        Ok(match self.get()? {
            Some((credential, storage)) => credential.status(storage),
            None => KeyStatus::none(),
        })
    }

    /// Validates, stores in the keychain (then removes any file copy) or,
    /// when the keychain fails, in the file (then clears the keychain).
    pub fn set(&self, key: &str, base_url: Option<&str>) -> Result<KeyStatus, AnalyticsError> {
        let credential = Credential::parse(self.provider, key, base_url)?;
        self.store(&credential)
    }

    fn store(&self, credential: &Credential) -> Result<KeyStatus, AnalyticsError> {
        let secret = credential.to_secret();
        let storage = match self.primary.set(&secret) {
            Ok(()) => {
                // A stale file copy would be read if the keychain later
                // becomes unreachable.
                let _ = self.fallback.delete();
                self.primary.kind()
            }
            Err(_) => {
                self.fallback.set(&secret).map_err(|error| {
                    AnalyticsError::internal(format!("The API key could not be stored: {error}"))
                })?;
                let _ = self.primary.delete();
                self.fallback.kind()
            }
        };
        Ok(credential.status(storage))
    }

    /// Clears both stores; fails only if a key is still readable after.
    pub fn delete(&self) -> Result<KeyStatus, AnalyticsError> {
        let primary = self.primary.delete();
        let fallback = self.fallback.delete();
        let status = self.status()?;
        if status.stored {
            let reason = [primary.err(), fallback.err()]
                .into_iter()
                .flatten()
                .map(|e| e.to_string())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(AnalyticsError::internal(format!(
                "The API key could not be deleted: {reason}"
            )));
        }
        Ok(status)
    }
}

/// The store the app uses for a provider: system keychain, then the file.
pub fn store_for(
    provider: AiProvider,
) -> Result<LayeredStore<KeyringStore, FileStore>, AnalyticsError> {
    Ok(LayeredStore::for_provider(
        provider,
        KeyringStore::for_provider(provider),
        FileStore::for_provider(provider)?,
    ))
}

/// Anthropic's store (as before providers).
pub fn default_store() -> Result<LayeredStore<KeyringStore, FileStore>, AnalyticsError> {
    store_for(AiProvider::Anthropic)
}

pub fn key_status() -> Result<KeyStatus, AnalyticsError> {
    key_status_for(AiProvider::Anthropic)
}

pub fn key_status_for(provider: AiProvider) -> Result<KeyStatus, AnalyticsError> {
    store_for(provider)?.status()
}

/// Trims and checks an Anthropic key (`sk-ant-`, 20-300 characters), then
/// stores it.
pub fn set_key(key: &str) -> Result<KeyStatus, AnalyticsError> {
    set_key_for(AiProvider::Anthropic, key, None)
}

/// Checks then stores a provider's key (with the server address for the
/// compatible provider). A typo never erases the stored key: nothing is
/// touched before the check passes.
pub fn set_key_for(
    provider: AiProvider,
    key: &str,
    base_url: Option<&str>,
) -> Result<KeyStatus, AnalyticsError> {
    let credential = Credential::parse(provider, key, base_url)?;
    store_for(provider)?.store(&credential)
}

pub fn delete_key() -> Result<KeyStatus, AnalyticsError> {
    delete_key_for(AiProvider::Anthropic)
}

pub fn delete_key_for(provider: AiProvider) -> Result<KeyStatus, AnalyticsError> {
    store_for(provider)?.delete()
}

/// The stored Anthropic key, or `no_key`.
pub fn get_key() -> Result<ApiKey, AnalyticsError> {
    match get_credential(AiProvider::Anthropic)? {
        Credential::Anthropic(key) => Ok(key),
        _ => Err(AnalyticsError::internal("unexpected credential")),
    }
}

/// What a provider needs, or `no_key`.
pub fn get_credential(provider: AiProvider) -> Result<Credential, AnalyticsError> {
    match store_for(provider)?.get()? {
        Some((credential, _)) => Ok(credential),
        None => Err(AnalyticsError::new(
            ErrorCode::NoKey,
            match provider {
                AiProvider::OpenAiCompatible => {
                    "No AI server address is saved on this computer".to_string()
                }
                _ => format!("No {} API key is stored on this computer", provider.label()),
            },
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const KEY: &str = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const OPENAI_KEY: &str = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";

    fn anthropic_key(credential: &Credential) -> &str {
        match credential {
            Credential::Anthropic(key) => key.expose(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn validates_keys() {
        assert_eq!(ApiKey::parse(&format!("  {KEY}\n")).unwrap().expose(), KEY);
        for bad in [
            "",
            "sk-ant-",
            "sk-ant-short",
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
            "sk-ant-abc def ghi jkl mno pqr",
            "sk-ant-abcdefghijklmnopqrstuvwxyzé",
        ] {
            let error = ApiKey::parse(bad).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidKey, "{bad:?}");
            // The message never echoes what was typed.
            assert!(
                bad.len() < 8 || !error.message.contains(&bad[7..]),
                "{bad:?}"
            );
        }
        let long = format!("sk-ant-{}", "a".repeat(KEY_MAX_LEN));
        assert!(ApiKey::parse(&long).is_err());
        let max = format!("sk-ant-{}", "a".repeat(KEY_MAX_LEN - 7));
        assert!(ApiKey::parse(&max).is_ok());
    }

    #[test]
    fn validates_openai_and_compatible_keys() {
        let openai = AiProvider::OpenAi;
        assert_eq!(
            ApiKey::parse_for(openai, &format!(" {OPENAI_KEY} "))
                .unwrap()
                .expose(),
            OPENAI_KEY
        );
        ApiKey::parse_for(openai, "sk-svcacct-0123456789abcdefghij").unwrap();
        let error = ApiKey::parse_for(openai, KEY).unwrap_err();
        assert!(error.message.contains("Anthropic"), "{}", error.message);
        assert!(!error.message.contains("abcdef"));
        for bad in [
            "",
            "sk-short",
            "pk-0123456789abcdefghijkl",
            "sk-proj abc def ghi jkl mno",
        ] {
            assert_eq!(
                ApiKey::parse_for(openai, bad).unwrap_err().code,
                ErrorCode::InvalidKey,
                "{bad:?}"
            );
        }
        let compatible = AiProvider::OpenAiCompatible;
        ApiKey::parse_for(compatible, "or-v1-0123456789").unwrap();
        ApiKey::parse_for(compatible, "abcdefgh").unwrap();
        assert!(ApiKey::parse_for(compatible, "short").is_err());
        assert!(ApiKey::parse_for(compatible, "with space inside").is_err());
    }

    #[test]
    fn compatible_connection_round_trips_with_or_without_a_key() {
        let with = Credential::parse(
            AiProvider::OpenAiCompatible,
            " mistral-key-0123456789 ",
            Some("https://api.mistral.ai/v1/"),
        )
        .unwrap();
        let secret = with.to_secret();
        assert!(!format!("{secret:?}").contains("mistral-key"));
        assert_eq!(
            Credential::from_secret(AiProvider::OpenAiCompatible, &secret),
            Some(with.clone())
        );
        let status = with.status(KeyStorage::Keychain);
        assert_eq!(
            status.base_url.as_deref(),
            Some("https://api.mistral.ai/v1")
        );
        assert_eq!(status.has_key, Some(true));

        let local = Credential::parse(
            AiProvider::OpenAiCompatible,
            "",
            Some("http://localhost:11434/v1"),
        )
        .unwrap();
        let status = local.status(KeyStorage::File);
        assert_eq!(status.has_key, Some(false));
        assert_eq!(
            Credential::from_secret(AiProvider::OpenAiCompatible, &local.to_secret()),
            Some(local)
        );
        // The address is required and checked; a stored garbage reads as none.
        assert!(Credential::parse(AiProvider::OpenAiCompatible, "", None).is_err());
        assert!(Credential::parse(
            AiProvider::OpenAiCompatible,
            "",
            Some("http://192.168.1.4/v1")
        )
        .is_err());
        for garbage in [
            "",
            "{}",
            "not json",
            "{\"baseUrl\":\"http://evil.example\"}",
        ] {
            assert_eq!(
                Credential::from_secret(AiProvider::OpenAiCompatible, &Secret::new(garbage)),
                None,
                "{garbage}"
            );
        }
        // Anthropic and OpenAI statuses carry no address.
        let status = Credential::parse(AiProvider::OpenAi, OPENAI_KEY, Some("https://x.example"))
            .unwrap()
            .status(KeyStorage::Keychain);
        assert_eq!(
            status,
            KeyStatus {
                hint: Some("-abc".into()),
                ..KeyStatus::stored(KeyStorage::Keychain)
            }
        );
    }

    #[test]
    fn status_shows_only_the_last_four_characters() {
        let anthropic = Credential::parse(AiProvider::Anthropic, KEY, None).unwrap();
        let status = anthropic.status(KeyStorage::Keychain);
        assert_eq!(status.hint.as_deref(), Some("6789"));
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("abcdefgh"), "{json}");
        // A compatible server: the hint of its key, none without a key.
        let with = Credential::parse(
            AiProvider::OpenAiCompatible,
            "mistral-key-WXYZ",
            Some("https://api.mistral.ai/v1"),
        )
        .unwrap();
        assert_eq!(with.status(KeyStorage::File).hint.as_deref(), Some("WXYZ"));
        let local = Credential::parse(
            AiProvider::OpenAiCompatible,
            "",
            Some("http://localhost:11434/v1"),
        )
        .unwrap();
        assert_eq!(local.status(KeyStorage::File).hint, None);
        // A short key keeps its hint to itself.
        let short = Credential::parse(
            AiProvider::OpenAiCompatible,
            "12345678",
            Some("http://localhost:11434/v1"),
        )
        .unwrap();
        assert_eq!(short.status(KeyStorage::File).hint, None);
        assert_eq!(KeyStatus::none().hint, None);
    }

    #[test]
    fn one_account_and_file_per_provider() {
        let accounts: Vec<&str> = AiProvider::ALL.iter().map(|p| account(*p)).collect();
        assert_eq!(
            accounts,
            [
                "anthropic-api-key",
                "openai-api-key",
                "openai-compatible-connection"
            ]
        );
        if let (Ok(a), Ok(b)) = (
            FileStore::for_provider(AiProvider::Anthropic),
            FileStore::for_provider(AiProvider::OpenAi),
        ) {
            assert_ne!(a.path(), b.path());
            assert_eq!(a.path(), crate::paths::key_file_path().unwrap());
        }
    }

    #[test]
    fn debug_hides_the_key() {
        let key = ApiKey::parse(KEY).unwrap();
        let shown = format!(
            "{key:?} {:?} {:?}",
            Some(&key),
            Credential::Anthropic(key.clone())
        );
        assert!(!shown.contains("abcdef"), "{shown}");
        assert!(shown.contains("hidden"));
    }

    #[test]
    fn file_store_round_trip_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().join("cfg").join("secrets").join("key"));
        assert_eq!(store.get().unwrap(), None);
        store.delete().unwrap();
        let key = Secret::new(KEY);
        store.set(&key).unwrap();
        assert_eq!(store.get().unwrap(), Some(key.clone()));
        assert!(!store.path().with_extension("tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(store.path()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
            let dir_mode = fs::metadata(store.path().parent().unwrap())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(dir_mode & 0o777, 0o700);
        }
        // Overwrite, then delete.
        let other = Secret::new(format!("{KEY}XYZ"));
        store.set(&other).unwrap();
        assert_eq!(store.get().unwrap(), Some(other));
        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn file_store_garbage_reads_as_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("key");
        fs::write(&path, "not a key").unwrap();
        let store = LayeredStore::new(
            FakeStore::new(false, KeyStorage::Keychain),
            FileStore::new(&path),
        );
        assert_eq!(store.get().unwrap(), None);
    }

    /// A keychain that works or fails on demand.
    struct FakeStore {
        works: bool,
        value: RefCell<Option<Secret>>,
        kind: KeyStorage,
    }

    impl FakeStore {
        fn new(works: bool, kind: KeyStorage) -> Self {
            FakeStore {
                works,
                value: RefCell::new(None),
                kind,
            }
        }
        fn check(&self) -> Result<(), StoreError> {
            if self.works {
                Ok(())
            } else {
                Err(StoreError(
                    "keychain: no credential store on this system".into(),
                ))
            }
        }
    }

    impl KeyStore for FakeStore {
        fn kind(&self) -> KeyStorage {
            self.kind
        }
        fn get(&self) -> Result<Option<Secret>, StoreError> {
            self.check()?;
            Ok(self.value.borrow().clone())
        }
        fn set(&self, key: &Secret) -> Result<(), StoreError> {
            self.check()?;
            *self.value.borrow_mut() = Some(key.clone());
            Ok(())
        }
        fn delete(&self) -> Result<(), StoreError> {
            self.check()?;
            *self.value.borrow_mut() = None;
            Ok(())
        }
    }

    #[test]
    fn layered_store_prefers_the_keychain() {
        let store = LayeredStore::new(
            FakeStore::new(true, KeyStorage::Keychain),
            FakeStore::new(true, KeyStorage::File),
        );
        *store.fallback.value.borrow_mut() = Some(Secret::new(KEY));
        let status = store.set(KEY, None).unwrap();
        assert_eq!(status.storage, Some(KeyStorage::Keychain));
        assert!(
            store.fallback.value.borrow().is_none(),
            "stale file copy removed"
        );
        assert_eq!(store.status().unwrap().storage, Some(KeyStorage::Keychain));
        assert_eq!(store.delete().unwrap(), KeyStatus::none());
    }

    #[test]
    fn layered_store_falls_back_to_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = LayeredStore::new(
            FakeStore::new(false, KeyStorage::Keychain),
            FileStore::new(dir.path().join("secrets").join("key")),
        );
        assert_eq!(store.status().unwrap(), KeyStatus::none());
        let status = store.set(KEY, None).unwrap();
        assert_eq!(
            status,
            KeyStatus {
                hint: Some("6789".into()),
                ..KeyStatus::stored(KeyStorage::File)
            }
        );
        let (credential, storage) = store.get().unwrap().unwrap();
        assert_eq!(
            (anthropic_key(&credential), storage),
            (KEY, KeyStorage::File)
        );
        assert!(!store.delete().unwrap().stored);
    }

    #[test]
    fn providers_never_read_each_other() {
        let shared = || {
            LayeredStore::for_provider(
                AiProvider::OpenAi,
                FakeStore::new(true, KeyStorage::Keychain),
                FakeStore::new(true, KeyStorage::File),
            )
        };
        let openai = shared();
        // An Anthropic key left in the OpenAI entry is not an OpenAI key.
        *openai.primary.value.borrow_mut() = Some(Secret::new(KEY));
        assert_eq!(openai.get().unwrap(), None);
        assert_eq!(
            openai.set(KEY, None).unwrap_err().code,
            ErrorCode::InvalidKey
        );
        openai.set(OPENAI_KEY, None).unwrap();
        assert!(matches!(
            openai.get().unwrap(),
            Some((Credential::OpenAi(_), _))
        ));

        let compatible = LayeredStore::for_provider(
            AiProvider::OpenAiCompatible,
            FakeStore::new(true, KeyStorage::Keychain),
            FakeStore::new(true, KeyStorage::File),
        );
        let status = compatible
            .set("", Some("http://127.0.0.1:1234/v1"))
            .unwrap();
        assert_eq!(status.base_url.as_deref(), Some("http://127.0.0.1:1234/v1"));
        assert_eq!(status.has_key, Some(false));
        assert!(compatible
            .primary
            .value
            .borrow()
            .as_ref()
            .unwrap()
            .expose()
            .starts_with('{'));
    }

    #[test]
    fn invalid_key_is_refused_before_any_store_is_touched() {
        let store = LayeredStore::new(
            FakeStore::new(true, KeyStorage::Keychain),
            FakeStore::new(true, KeyStorage::File),
        );
        store.set(KEY, None).unwrap();
        assert_eq!(
            store.set("oops", None).unwrap_err().code,
            ErrorCode::InvalidKey
        );
        assert_eq!(anthropic_key(&store.get().unwrap().unwrap().0), KEY);
    }

    /// The Raspberry Pi kiosk case for real: on Linux without a session
    /// bus there is no Secret Service, so the key lands in the file, fast.
    #[test]
    fn real_keyring_without_session_bus_falls_back_to_the_file() {
        if !cfg!(target_os = "linux") || std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let store = LayeredStore::new(
            KeyringStore::with_entry(KEYRING_SERVICE, "rb-analytics-test"),
            FileStore::new(dir.path().join("secrets").join("key")),
        );
        let started = std::time::Instant::now();
        assert_eq!(
            store.set(KEY, None).unwrap().storage,
            Some(KeyStorage::File)
        );
        assert_eq!(store.status().unwrap().storage, Some(KeyStorage::File));
        assert!(!store.delete().unwrap().stored);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    /// Needs a desktop session with a keychain: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn keyring_round_trip() {
        let store = KeyringStore::with_entry(KEYRING_SERVICE, "rb-analytics-test");
        let key = Secret::new(KEY);
        store.set(&key).unwrap();
        assert_eq!(store.get().unwrap(), Some(key));
        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }
}
