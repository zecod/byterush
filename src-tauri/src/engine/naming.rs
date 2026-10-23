//! File naming, categories and URL heuristics.

use super::types::Category;
use percent_encoding::percent_decode_str;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const COMPRESSED: &[&str] = &["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "iso", "cab", "zst", "lz", "lzh", "arj"];
const DOCUMENTS: &[&str] = &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "ods", "odp", "epub", "csv", "md"];
const MUSIC: &[&str] = &["mp3", "wav", "wma", "aac", "flac", "ogg", "m4a", "opus", "aif", "aiff", "mid"];
const PROGRAMS: &[&str] = &["exe", "msi", "msix", "appx", "dmg", "pkg", "deb", "rpm", "apk", "appimage"];
const VIDEO: &[&str] = &["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp", "ogv"];

pub fn extension(name: &str) -> Option<String> {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
}

pub fn category_for(name: &str) -> Category {
    let Some(ext) = extension(name) else { return Category::General };
    let ext = ext.as_str();
    if COMPRESSED.contains(&ext) {
        Category::Compressed
    } else if DOCUMENTS.contains(&ext) {
        Category::Documents
    } else if MUSIC.contains(&ext) {
        Category::Music
    } else if PROGRAMS.contains(&ext) {
        Category::Programs
    } else if VIDEO.contains(&ext) {
        Category::Video
    } else {
        Category::General
    }
}

pub fn category_folder(c: Category) -> Option<&'static str> {
    match c {
        Category::General => None,
        Category::Compressed => Some("Compressed"),
        Category::Documents => Some("Documents"),
        Category::Music => Some("Music"),
        Category::Programs => Some("Programs"),
        Category::Video => Some("Video"),
    }
}

/// True when a clipboard text looks like a direct link to a downloadable file.
pub fn looks_like_download(text: &str) -> bool {
    let text = text.trim();
    if text.len() > 4096 || text.contains(char::is_whitespace) {
        return false;
    }
    let Ok(url) = url::Url::parse(text) else { return false };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let last = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
    category_for(last) != Category::General
}

/// Make a name safe for Windows/Unix filesystems.
pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let cleaned: String = cleaned.chars().take(200).collect();
    if cleaned.is_empty() { "download".into() } else { cleaned }
}

/// Extract a file name from a Content-Disposition header (RFC 6266), preferring `filename*`.
pub fn from_content_disposition(value: &str) -> Option<String> {
    let mut plain = None;
    for part in value.split(';').map(str::trim) {
        let lower = part.to_ascii_lowercase();
        if lower.starts_with("filename*=") {
            let v = &part["filename*=".len()..];
            // charset'lang'percent-encoded
            let encoded = v.splitn(3, '\'').nth(2).unwrap_or(v);
            let decoded = percent_decode_str(encoded.trim_matches('"')).decode_utf8_lossy().to_string();
            if !decoded.is_empty() {
                return Some(decoded);
            }
        } else if lower.starts_with("filename=") {
            let v = part["filename=".len()..].trim().trim_matches('"');
            if !v.is_empty() {
                plain = Some(v.to_string());
            }
        }
    }
    plain
}

pub fn from_url(url: &url::Url) -> Option<String> {
    let last = url.path_segments()?.filter(|s| !s.is_empty()).next_back()?;
    let decoded = percent_decode_str(last).decode_utf8_lossy().to_string();
    (!decoded.is_empty()).then_some(decoded)
}

/// `dir/name`, or `dir/name (n).ext` if taken on disk or by `reserved`.
pub fn unique_path(dir: &Path, name: &str, reserved: &HashSet<PathBuf>) -> PathBuf {
    let taken = |p: &Path| reserved.contains(p) || p.exists() || part_path(p).exists();
    let first = dir.join(name);
    if !taken(&first) {
        return first;
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !taken(p))
        .expect("infinite iterator")
}

/// Temporary file used while downloading.
pub fn part_path(target: &Path) -> PathBuf {
    with_suffix(target, ".byterush")
}

/// Where the finished file is assembled before it is renamed into place, so a crash while
/// rebuilding or copying never leaves a half-written file under the real name.
pub fn staging_path(target: &Path) -> PathBuf {
    with_suffix(target, ".byterush-tmp")
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Whether a name the browser suggests is the file an existing download is saving, allowing for
/// the " (1)" the app adds to avoid overwriting.
pub fn same_file(suggested: &str, saved: &str) -> bool {
    let suggested = sanitize(suggested);
    if suggested.eq_ignore_ascii_case(saved) {
        return true;
    }
    let path = Path::new(saved);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let base = match stem.rsplit_once(" (") {
        Some((base, n)) if n.strip_suffix(')').is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())) => base,
        _ => return false,
    };
    suggested.eq_ignore_ascii_case(&format!("{base}{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition() {
        assert_eq!(from_content_disposition(r#"attachment; filename="a b.zip""#).as_deref(), Some("a b.zip"));
        assert_eq!(
            from_content_disposition("attachment; filename=x.bin; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf").as_deref(),
            Some("résumé.pdf")
        );
        assert_eq!(from_content_disposition("inline"), None);
    }

    #[test]
    fn categories_and_sanitize() {
        assert_eq!(category_for("Movie.MKV"), Category::Video);
        assert_eq!(category_for("setup.exe"), Category::Programs);
        assert_eq!(category_for("noext"), Category::General);
        assert_eq!(sanitize("a:b/c?.txt. "), "a_b_c_.txt");
        assert!(looks_like_download("https://x.com/files/a.zip"));
        assert!(!looks_like_download("https://x.com/page"));
        assert!(!looks_like_download("hello world.zip"));
    }

    #[test]
    fn recaptured_names_match() {
        assert!(same_file("setup.exe", "setup.exe"));
        assert!(same_file("Setup.EXE", "setup.exe"));
        assert!(same_file("setup.exe", "setup (2).exe"));
        assert!(!same_file("setup.exe", "setup (x).exe"));
        assert!(!same_file("setup.exe", "other.exe"));
        assert!(!same_file("setup (2).exe", "setup.exe"));
    }
}
