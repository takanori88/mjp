use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use url::Url;

pub const MAX_OPEN_FILES: usize = 10;
const MAX_FAILURE_DETAILS: usize = 10;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Origin {
    CliInitial,
    OsOpen,
}

impl Origin {
    pub fn reports_in_gui(self) -> bool {
        self == Self::OsOpen
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WindowKind {
    Document,
    Welcome,
    Failures,
}

impl WindowKind {
    pub fn replaces_welcome(self, created: bool) -> bool {
        self == Self::Document && created
    }
}

#[derive(Debug, PartialEq)]
pub enum OpenDecision {
    Load,
    Focus(String),
    Pending,
}

pub struct Requests {
    ready: bool,
    startup_pending: bool,
    welcome_requested: bool,
    pending: usize,
    queued: Vec<Vec<Url>>,
    loading: HashSet<PathBuf>,
    opened: HashMap<PathBuf, String>,
}

impl Default for Requests {
    fn default() -> Self {
        Self {
            ready: false,
            startup_pending: true,
            welcome_requested: false,
            pending: 0,
            queued: Vec::new(),
            loading: HashSet::new(),
            opened: HashMap::new(),
        }
    }
}

impl Requests {
    pub fn accept(&mut self, urls: Vec<Url>) -> Option<Vec<Url>> {
        if urls.is_empty() {
            return None;
        }
        self.begin();
        if self.ready {
            Some(urls)
        } else {
            self.queued.push(urls);
            None
        }
    }

    pub fn ready(&mut self) -> Vec<Vec<Url>> {
        self.ready = true;
        std::mem::take(&mut self.queued)
    }

    pub fn request_welcome(&mut self) -> bool {
        self.welcome_requested = true;
        self.ready
    }

    pub fn take_welcome_request(&mut self) -> bool {
        std::mem::take(&mut self.welcome_requested)
    }

    pub fn finish_startup(&mut self) {
        self.startup_pending = false;
    }

    pub fn begin(&mut self) {
        self.pending = self
            .pending
            .checked_add(1)
            .expect("request count exhausted");
    }

    pub fn finish(&mut self) {
        self.pending = self.pending.checked_sub(1).expect("no unfinished request");
    }

    pub fn has_pending(&self) -> bool {
        !self.ready || self.startup_pending || self.welcome_requested || self.pending != 0
    }

    pub fn prevents_exit(&self, code: Option<i32>, has_windows: bool) -> bool {
        code.is_none() && (has_windows || self.has_pending())
    }

    pub fn reserve(&mut self, canonical_path: &Path) -> OpenDecision {
        if let Some(label) = self.opened.get(canonical_path) {
            OpenDecision::Focus(label.clone())
        } else if self.loading.insert(canonical_path.to_path_buf()) {
            OpenDecision::Load
        } else {
            OpenDecision::Pending
        }
    }

    pub fn release(&mut self, path: &Path) {
        self.loading.remove(path);
    }

    pub fn opened(&mut self, path: PathBuf, label: String) {
        self.release(&path);
        self.opened.insert(path, label);
    }

    pub fn destroyed(&mut self, label: &str) {
        self.opened.retain(|_, window| window != label);
    }
}

pub fn classify_url(url: &Url) -> Result<PathBuf, &'static str> {
    if url.scheme() != "file" {
        return Err("only local file URLs can be opened");
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("file URLs cannot contain a query or fragment");
    }
    let path = url
        .to_file_path()
        .map_err(|_| "cannot convert URL to a local path")?;
    if path.as_os_str().as_encoded_bytes().contains(&0) {
        return Err("file path contains a NUL character");
    }
    Ok(path)
}

#[derive(Default)]
pub struct Failures {
    details: Vec<(String, String)>,
    omitted: usize,
}

impl Failures {
    pub fn push(&mut self, input: impl Into<String>, reason: impl Into<String>) {
        if self.details.len() < MAX_FAILURE_DETAILS {
            self.details.push((input.into(), reason.into()));
        } else {
            self.omitted += 1;
        }
    }

    pub fn is_empty(&self) -> bool {
        self.details.is_empty() && self.omitted == 0
    }

    pub fn markdown(&self) -> String {
        let lines: Vec<_> = self
            .details
            .iter()
            .map(|(input, reason)| format!("{}: {}", visible(input), visible(reason)))
            .collect();
        let longest_run = lines
            .iter()
            .flat_map(|line| line.split(|c| c != '`'))
            .map(str::len)
            .max()
            .unwrap_or(0);
        let fence = "`".repeat(3.max(longest_run + 1));
        let mut text = format!("# Files that could not be opened\n\nFix the file or request, then open it again.\n\n{fence}\n{}\n{fence}\n", lines.join("\n"));
        if self.omitted != 0 {
            text.push_str(&format!("\n{} more entries omitted.\n", self.omitted));
        }
        text
    }
}

fn visible(input: &str) -> String {
    input
        .chars()
        .flat_map(|c| match c {
            '\n' => "\\n".chars().collect::<Vec<_>>(),
            '\r' => "\\r".chars().collect(),
            '\t' => "\\t".chars().collect(),
            c if c.is_control() || matches!(c, '\u{2028}' | '\u{2029}') => {
                c.escape_unicode().collect()
            }
            c => vec![c],
        })
        .collect()
}

pub fn split_batch(urls: Vec<Url>) -> (Vec<PathBuf>, Failures) {
    let mut paths = Vec::new();
    let mut failures = Failures::default();
    for (index, url) in urls.into_iter().enumerate() {
        if index >= MAX_OPEN_FILES {
            failures.push(url.as_str(), "at most 10 files can be opened per request");
        } else {
            match classify_url(&url) {
                Ok(path) => paths.push(path),
                Err(reason) => failures.push(url.as_str(), reason),
            }
        }
    }
    (paths, failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(path: &str) -> Url {
        Url::from_file_path(path).unwrap()
    }

    #[test]
    fn accepts_local_paths_and_preserves_encoded_filename_characters() {
        for path in [
            "/tmp/a b.md",
            "/tmp/日本語.md",
            "/tmp/%#-`[a].markdown",
            "/tmp/new\nline.md",
        ] {
            assert_eq!(classify_url(&url(path)).unwrap(), PathBuf::from(path));
        }
    }

    #[test]
    fn reports_non_file_queries_fragments_and_unconvertible_urls() {
        for input in [
            "https://example.com/a.md",
            "file:///tmp/a.md?q=1",
            "file:///tmp/a.md#section",
            "file://remote/a.md",
            "file:///tmp/a%00.md",
        ] {
            assert!(
                classify_url(&Url::parse(input).unwrap()).is_err(),
                "{input}"
            );
        }
    }

    #[test]
    fn queues_each_request_once_and_keeps_drained_work_pending() {
        let mut requests = Requests::default();
        let a = vec![url("/tmp/a.md")];
        let b = vec![url("/tmp/b.md")];
        assert!(requests.accept(a.clone()).is_none());
        assert_eq!(requests.ready(), vec![a]);
        assert!(requests.ready().is_empty());
        requests.finish_startup();
        assert!(requests.has_pending());
        assert_eq!(requests.accept(b.clone()), Some(b));
        requests.finish();
        assert!(requests.has_pending());
        requests.finish();
        assert!(!requests.has_pending());
    }

    #[test]
    fn natural_exit_waits_for_windows_requests_and_the_welcome_decision() {
        let mut requests = Requests::default();
        assert!(requests.prevents_exit(None, false));
        requests.ready();
        assert!(requests.prevents_exit(None, false));
        requests.finish_startup();
        assert!(!requests.prevents_exit(None, false));
        assert!(requests.prevents_exit(None, true));
        requests.begin();
        assert!(requests.prevents_exit(None, false));
        assert!(!requests.prevents_exit(Some(0), false));
        requests.finish();
        assert!(!requests.prevents_exit(None, false));
    }

    #[test]
    fn focuses_open_files_and_coalesces_files_already_loading() {
        let mut requests = Requests::default();
        let path = PathBuf::from("/tmp/a.md");
        assert_eq!(requests.reserve(&path), OpenDecision::Load);
        assert_eq!(requests.reserve(&path), OpenDecision::Pending);
        requests.opened(path.clone(), "preview-1".into());
        assert_eq!(
            requests.reserve(&path),
            OpenDecision::Focus("preview-1".into())
        );
        requests.destroyed("preview-1");
        assert_eq!(requests.reserve(&path), OpenDecision::Load);
    }

    #[test]
    fn failed_reads_and_window_builds_can_be_requested_again() {
        let mut requests = Requests::default();
        let path = Path::new("/tmp/a.md");
        for _ in 0..3 {
            assert_eq!(requests.reserve(path), OpenDecision::Load);
            requests.release(path);
            assert!(requests.opened.is_empty());
        }
    }

    #[test]
    fn one_request_opens_at_most_ten_inputs_and_reports_every_remainder() {
        for count in [0, 1, 10, 11, 25] {
            let urls = (0..count).map(|n| url(&format!("/tmp/{n}.md"))).collect();
            let (paths, failures) = split_batch(urls);
            assert_eq!(paths.len(), count.min(MAX_OPEN_FILES));
            assert_eq!(failures.is_empty(), count <= MAX_OPEN_FILES);
            assert_eq!(
                failures.details.len() + failures.omitted,
                count.saturating_sub(MAX_OPEN_FILES)
            );
        }
    }

    #[test]
    fn failure_details_stay_on_single_lines_inside_a_longer_fence() {
        let mut failures = Failures::default();
        failures.push("/tmp/````\n# name\r\t\0.md", "cannot\nread");
        let text = failures.markdown();
        assert!(text.contains("\n`````\n/tmp/````\\n# name\\r\\t\\u{0}.md: cannot\\nread\n`````\n"));
        for _ in 0..12 {
            failures.push("another", "missing");
        }
        assert!(failures.markdown().contains("3 more entries omitted."));
    }

    #[test]
    fn only_a_successfully_created_document_replaces_welcome() {
        assert!(WindowKind::Document.replaces_welcome(true));
        assert!(!WindowKind::Document.replaces_welcome(false));
        assert!(!WindowKind::Failures.replaces_welcome(true));
        assert!(!WindowKind::Welcome.replaces_welcome(true));
    }

    #[test]
    fn os_open_errors_use_gui_even_when_received_by_a_cli_child() {
        assert!(Origin::OsOpen.reports_in_gui());
        assert!(!Origin::CliInitial.reports_in_gui());
    }
    #[test]
    fn reopen_before_ready_waits_for_startup_and_reopen_after_ready_stays_pending() {
        let mut requests = Requests::default();
        assert!(!requests.request_welcome());
        requests.ready();
        assert!(requests.take_welcome_request());
        assert!(!requests.take_welcome_request());
        requests.finish_startup();
        assert!(!requests.has_pending());
        assert!(requests.request_welcome());
        assert!(requests.has_pending());
        assert!(requests.take_welcome_request());
        assert!(!requests.has_pending());
    }
    #[test]
    fn empty_open_events_leave_the_fileless_startup_decision_available() {
        let mut requests = Requests::default();
        assert!(requests.accept(Vec::new()).is_none());
        assert!(requests.ready().is_empty());
        requests.finish_startup();
        assert!(!requests.has_pending());
    }
}
