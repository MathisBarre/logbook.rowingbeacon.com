//! Test helpers of the AI providers: a request, a tokio runtime, and local
//! stub servers that answer canned HTTP responses and report what they
//! received.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use serde_json::{json, Value};

use crate::ipc::{AiAskRequest, AiEffort, AiMessage, AiProvider, AiRole, AiSystemBlock};

pub(crate) fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "sql"],
        "properties": {
            "title": { "type": "string" },
            "sql": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
        }
    })
}

/// One question, one cached system block, 8,000 tokens.
pub(crate) fn request(provider: AiProvider, model: &str) -> AiAskRequest {
    AiAskRequest {
        request_id: "3f0e6c39-6d2a-4d43-9b8e-1f6f2c1b9a10".into(),
        provider,
        model: model.into(),
        effort: AiEffort::Medium,
        system: vec![AiSystemBlock {
            text: "You write SQLite queries.".into(),
            cache: true,
        }],
        messages: vec![AiMessage {
            role: AiRole::User,
            content: "Quels bateaux sortent le plus ?".into(),
        }],
        output_schema: schema(),
        max_tokens: 8000,
    }
}

pub(crate) fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

/// What a stub saw: request line, lower-cased headers, body.
#[derive(Debug)]
pub(crate) struct Seen {
    pub request_line: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

fn read_request(stream: &std::net::TcpStream) -> Seen {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    reader.read_line(&mut request_line).unwrap();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').unwrap();
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    let length: usize = headers
        .iter()
        .find(|(n, _)| n == "content-length")
        .map_or(0, |(_, v)| v.parse().unwrap());
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    Seen {
        request_line: request_line.trim_end().to_string(),
        headers,
        body: String::from_utf8(body).unwrap(),
    }
}

fn response(status: u16, extra_headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\n{extra_headers}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Serves one canned HTTP response on 127.0.0.1 and reports the request.
pub(crate) fn stub(status: u16, extra_headers: &str, body: &str) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let response = response(status, extra_headers, body);
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let seen = read_request(&stream);
        stream.write_all(response.as_bytes()).unwrap();
        let _ = tx.send(seen);
    });
    (base, rx)
}

/// Serves the responses in order, one connection each.
pub(crate) fn stub_sequence(responses: Vec<(u16, String)>) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for (status, body) in responses {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let seen = read_request(&stream);
            let _ = stream.write_all(response(status, "", &body).as_bytes());
            let _ = tx.send(seen);
        }
    });
    (base, rx)
}
