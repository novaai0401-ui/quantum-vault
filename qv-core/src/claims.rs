use std::collections::HashMap;
use crate::error::{QVError, QVResult};

/// A simple string → string claims map (MessagePack-compatible via manual encoding).
///
/// We avoid pulling in a full MessagePack dependency by encoding as a flat
/// key-value map using a minimal subset:
///   - fixmap (up to 15 entries):  0x8N
///   - fixstr  (up to 31 bytes):   0xAL + utf8 bytes
///   - str8   (up to 255 bytes):   0xd9 LL + utf8 bytes
#[derive(Debug, Clone, Default)]
pub struct Claims(pub HashMap<String, String>);

impl Claims {
    pub fn new() -> Self { Claims(HashMap::new()) }

    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.0.insert(key.into(), value.into());
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }

    pub fn require(&self, key: &str) -> QVResult<&str> {
        self.get(key).ok_or_else(|| QVError::MissingClaim(key.to_string()))
    }

    /// Encode to bytes (subset MessagePack).
    pub fn encode(&self) -> QVResult<Vec<u8>> {
        if self.0.len() > 15 {
            return Err(QVError::SerializationError("too many claims (max 15)".into()));
        }
        let mut out = Vec::new();
        out.push(0x80 | self.0.len() as u8); // fixmap
        for (k, v) in &self.0 {
            encode_str(&mut out, k)?;
            encode_str(&mut out, v)?;
        }
        Ok(out)
    }

    /// Decode from bytes.
    pub fn decode(data: &[u8]) -> QVResult<Self> {
        if data.is_empty() {
            return Err(QVError::BufferTooShort { need: 1, have: 0 });
        }
        let first = data[0];
        if first & 0xF0 != 0x80 {
            return Err(QVError::SerializationError("expected fixmap".into()));
        }
        let n = (first & 0x0F) as usize;
        let mut pos = 1;
        let mut map = HashMap::new();
        for _ in 0..n {
            let (k, adv) = decode_str(&data[pos..])?;
            pos += adv;
            let (v, adv) = decode_str(&data[pos..])?;
            pos += adv;
            map.insert(k, v);
        }
        Ok(Claims(map))
    }
}

fn encode_str(out: &mut Vec<u8>, s: &str) -> QVResult<()> {
    let b = s.as_bytes();
    if b.len() <= 31 {
        out.push(0xA0 | b.len() as u8);
    } else if b.len() <= 255 {
        out.push(0xd9);
        out.push(b.len() as u8);
    } else {
        return Err(QVError::SerializationError("claim string too long (max 255)".into()));
    }
    out.extend_from_slice(b);
    Ok(())
}

fn decode_str(data: &[u8]) -> QVResult<(String, usize)> {
    if data.is_empty() {
        return Err(QVError::BufferTooShort { need: 1, have: 0 });
    }
    let (len, header) = if data[0] & 0xE0 == 0xA0 {
        ((data[0] & 0x1F) as usize, 1)
    } else if data[0] == 0xd9 {
        if data.len() < 2 {
            return Err(QVError::BufferTooShort { need: 2, have: data.len() });
        }
        (data[1] as usize, 2)
    } else {
        return Err(QVError::SerializationError(format!("unexpected msgpack byte {:#04x}", data[0])));
    };
    if data.len() < header + len {
        return Err(QVError::BufferTooShort { need: header + len, have: data.len() });
    }
    let s = std::str::from_utf8(&data[header..header + len])
        .map_err(|e| QVError::SerializationError(e.to_string()))?
        .to_string();
    Ok((s, header + len))
}
