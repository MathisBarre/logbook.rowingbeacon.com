//! Tauri commands of the analytics feature (plan 2.2, ADR 0008): thin
//! wrappers over the `rb-analytics` crate. Blocking work (SQLite, files,
//! keychain) runs on `spawn_blocking`; every error crosses the IPC as the
//! serialized `AnalyticsError` (`{ code, message, … }`).
//!
//! The names and arguments are the contract of `src/analytics/engine/ipc.ts`
//! (`ANALYTICS_COMMANDS`): JS sends camelCase keys (`requestId`), Tauri maps
//! them to these snake_case arguments.

use std::sync::Arc;

use rb_analytics::engine::{self, EngineContext, EngineState};
use rb_analytics::error::AnalyticsError;
use rb_analytics::ipc::{
    AiAskRequest, AiAskResponse, AiKeyTest, AiProvider, EngineObjects, InboxProposal, KeyStatus,
    McpInfo, McpLastCall, Privacy, QueryResult, RunQueryRequest,
};
use rb_analytics::perf::{self, MachineInfo};
use rb_analytics::{ai, mcp, paths};
use tauri::State;

/// The app always reads nominatively; the UI checks report visibility.
/// The limits are those of the club's performance profile, read from
/// `main.db` at each call (`perf::app_limits`), never from the webview.
fn app_context() -> Result<EngineContext, AnalyticsError> {
    let db_path = paths::db_path()?;
    let limits = perf::app_limits(&db_path);
    Ok(EngineContext {
        db_path,
        privacy: Privacy::Nominative,
        limits,
    })
}

async fn blocking<T, F>(work: F) -> Result<T, AnalyticsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AnalyticsError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AnalyticsError::internal(format!("analytics task failed: {e}")))?
}

#[tauri::command]
pub async fn analytics_run_query(
    state: State<'_, Arc<EngineState>>,
    request: RunQueryRequest,
) -> Result<QueryResult, AnalyticsError> {
    let state = Arc::clone(state.inner());
    blocking(move || engine::run_query(&state, &app_context()?, &request)).await
}

#[tauri::command]
pub async fn analytics_cancel_query(
    state: State<'_, Arc<EngineState>>,
    request_id: String,
) -> Result<(), AnalyticsError> {
    engine::cancel(state.inner(), &request_id);
    Ok(())
}

#[tauri::command]
pub async fn analytics_list_objects() -> Result<EngineObjects, AnalyticsError> {
    blocking(|| engine::list_objects(&app_context()?)).await
}

// AI commands (ADR 0008, "AI providers"): `provider` is optional so that
// a call without it means Anthropic, as before providers existed.

#[tauri::command]
pub async fn analytics_ai_key_status(
    provider: Option<AiProvider>,
) -> Result<KeyStatus, AnalyticsError> {
    let provider = provider.unwrap_or_default();
    blocking(move || ai::key_store::key_status_for(provider)).await
}

/// `baseUrl` is the compatible server's address, saved with its key (the
/// key may then be empty: a local server needs none).
#[tauri::command]
pub async fn analytics_ai_set_key(
    provider: Option<AiProvider>,
    key: String,
    base_url: Option<String>,
) -> Result<KeyStatus, AnalyticsError> {
    let provider = provider.unwrap_or_default();
    blocking(move || ai::key_store::set_key_for(provider, &key, base_url.as_deref())).await
}

#[tauri::command]
pub async fn analytics_ai_delete_key(
    provider: Option<AiProvider>,
) -> Result<KeyStatus, AnalyticsError> {
    let provider = provider.unwrap_or_default();
    blocking(move || ai::key_store::delete_key_for(provider)).await
}

/// The key is read on a blocking thread (keychain prompt, Secret Service
/// over D-Bus, file), then the HTTP call is awaited.
#[tauri::command]
pub async fn analytics_ai_test_key(
    provider: Option<AiProvider>,
    model: String,
) -> Result<AiKeyTest, AnalyticsError> {
    let provider = provider.unwrap_or_default();
    let credential = blocking(move || Ok(ai::key_store::get_credential(provider))).await?;
    ai::test_key_with(provider, &model, credential).await
}

#[tauri::command]
pub async fn analytics_ai_ask(request: AiAskRequest) -> Result<AiAskResponse, AnalyticsError> {
    // Checked before the key is read, as `ai::ask` does.
    ai::check_request(&request)?;
    let provider = request.provider;
    let credential = blocking(move || ai::key_store::get_credential(provider)).await?;
    ai::ask_with_credential(&request, &credential).await
}

#[tauri::command]
pub async fn analytics_mcp_info() -> Result<McpInfo, AnalyticsError> {
    paths::mcp_info()
}

/// The last question an AI app sent through MCP on this computer (None:
/// no app has connected yet). Read from `mcp-last-call.json`.
#[tauri::command]
pub async fn analytics_mcp_last_call() -> Result<Option<McpLastCall>, AnalyticsError> {
    blocking(|| Ok(mcp::last_call(&paths::inbox_dir()?))).await
}

/// Memory, CPUs and the recommended performance profile (detected once).
#[tauri::command]
pub async fn analytics_machine_info() -> Result<MachineInfo, AnalyticsError> {
    blocking(|| Ok(perf::machine().clone())).await
}

#[tauri::command]
pub async fn analytics_inbox_list() -> Result<Vec<InboxProposal>, AnalyticsError> {
    blocking(|| mcp::inbox_list(&paths::inbox_dir()?)).await
}

#[tauri::command]
pub async fn analytics_inbox_remove(id: String) -> Result<(), AnalyticsError> {
    blocking(move || mcp::inbox_remove(&paths::inbox_dir()?, &id)).await
}
