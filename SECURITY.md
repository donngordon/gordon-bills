# Gordon Bills — Security & Testing

Last review: **November 19, 2026** · App version 8 · Mapped to **NIST Cybersecurity Framework 2.0** with controls from **NIST SP 800-53 Rev. 5** and **SP 800-63B**.

## Results at a glance

| Check | Result |
|---|---|
| Automated end-to-end tests (iPhone, Android, desktop) | **44 / 44 pass** |
| Accessibility (axe-core, WCAG 2.1 AA) | **0 violations** on home, payment and install screens |
| Lighthouse – app (mobile) | Performance **99** · Accessibility **100** · Best practices **96** |
| Lighthouse – install page (mobile) | Performance **100** · Accessibility **100** · Best practices **96** |
| Speed | First paint **1.7 s** on a throttled mid-range phone, **0 ms** blocking time, no layout shift, **93 KB** total |
| Secrets in this public repository | **None** (no family code, API token or passwords) |

Run the tests yourself: `node tests/run-tests.js` (needs Node and Playwright).

## NIST CSF 2.0 mapping

| Function | What the app does | NIST controls |
|---|---|---|
| **Govern** | Two named household users; this document records the review, open items and review cadence | GV.PO, PL-2 |
| **Identify** | Assets: this app (GitHub Pages), the bill tracker Google Sheet, the Apps Script email/automation service, the family code | ID.AM, CM-8 |
| **Protect – access** | Bill data is only returned with the family code; the code is checked on the server for every read and save. "Sign out of this phone" clears the code and cached bills | PR.AA, AC-3, IA-5, SP 800-63B §5.1.1 |
| **Protect – data in transit** | HTTPS only (GitHub Pages + Google); `upgrade-insecure-requests` | PR.DS-02, SC-8 |
| **Protect – code integrity** | Strict Content-Security-Policy: scripts allowed only by SHA-256 hash, no plugins, no forms to other sites, `base-uri 'none'`. Verified: injected scripts are blocked | PR.PS, SI-10, SC-18 |
| **Protect – input handling** | All bill names, notes and questions are escaped before display. Verified with a script-injection (XSS) test | SI-10, SI-15 |
| **Protect – privacy** | `Referrer-Policy: no-referrer` so the family code in the address is never sent to other sites | PR.DS, SC-28 |
| **Detect** | Every payment, status change and question sends a confirmation email to both of us and is time-stamped in the Sheet | DE.CM, AU-2, AU-3 |
| **Respond** | Email-limit (Google quota) errors are detected and handled; the app confirms whether the save went through instead of showing a raw error | RS.MI, SI-11 |
| **Recover** | Google Sheets version history; weekly backup copy (see open items); app works offline from cache | RC.RP, CP-9, CP-10 |
| **Updates** | "New update ready" banner — tap to load the newest version; tested end-to-end | PR.PS-02, SI-2 |

## Open items (need the Apps Script service updated from the laptop)

1. **Rate-limit wrong family-code attempts** on the server (AC-7). The code is 8 random characters (~41 bits) but should still lock out after repeated failures.
2. **Never fail a save because of email**; queue emails and send after Google's daily limit resets (SC-5 availability).
3. **Weekly backup** of the bill tracker Sheet to a dated copy in Google Drive, keeping 12 weeks (CP-9).
4. **Rotate the family code** if a phone is lost (IA-5). After rotating, each phone signs in once with the new code.
5. Fewer emails per edit (combine quick back-to-back changes) to stay under Google's limit.

## Review cadence

Automated tests and this review run every Sunday night; results are emailed to both of us and the run is on the shared calendar.
