# Chrome Web Store Listing — TabOrganizer

## Short Description (≤132 chars)

Organize browser tabs into windows by domain, deduplicate URLs, clean up Zoom links, and create tab groups.

## Detailed Description

TabOrganizer automatically reorganizes all the tabs in your Chrome profile into clean, domain-grouped windows.

**How it works:**
• Groups tabs by registrable domain (eTLD+1) — so mail.google.com and docs.google.com both go to the "google.com" window.
• Creates a new window per domain when that domain has at least N tabs (default N=5, configurable).
• Moves remaining tabs into a single "misc" window.
• Sorts tabs by most recently visited.
• Optionally closes duplicate tabs (same URL, ignoring fragments) and Zoom "Join Meeting" jump links before organizing.
• Creates Chrome tab groups inside each window, grouped by subdomain.

**Search & Act:**
Find any tab across all windows by title or URL (text or regex). Then move matches to a new window, group them, close them, deduplicate, or clean up Zoom links — all from the search results.

**Clear Stale Tabs:**
Preview and close tabs you haven't visited in the last hour, day, week, or month.

**Configurable Options:**
• Threshold for domain windows (minimum tabs per domain)
• Include/exclude pinned tabs
• Close emptied old windows
• Close duplicates before organizing
• Close Zoom jump links before organizing
• Create tab groups per subdomain
• Unpin tabs for grouping

**Privacy:**
All processing happens locally in your browser. No data is collected, transmitted, or stored externally. No analytics. No remote code.

## Category

Productivity

## Permission Justifications

### host_permissions (http://*/*, https://*/*)
Required to read tab.url for every open tab in order to extract the registrable domain (eTLD+1) for grouping. The extension organizes ALL tabs across ALL windows, so it needs access to all URLs. No tab content is read or modified — only the URL is used for domain extraction.

### tabs
Required to query all open tabs, move tabs between windows, create tab groups, and close duplicate/stale tabs. This is the core functionality of the extension.

### windows
Required to create new windows for domain-grouped tabs and to optionally close windows that become empty after tabs are moved out.

### storage
Required to persist user preferences (threshold, toggle settings) locally via chrome.storage.local. No data is synced or transmitted.

### tabGroups
Required to create and manage Chrome tab groups within the organized windows (grouping tabs by subdomain within each domain window).

## Single Purpose Description

Organizes browser tabs into windows grouped by domain, with search, deduplication, and stale tab cleanup.

## Remote Code

No. The extension does not load or execute any remote code.
