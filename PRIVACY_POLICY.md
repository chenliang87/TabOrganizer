# Privacy Policy — TabOrganizer

**Last updated:** April 5, 2026

## Summary

TabOrganizer does **not** collect, transmit, or store any personal data. All processing happens locally in your browser.

## Data Handling

- **Tab URLs and titles** are read solely to group tabs by domain. This data is never sent to any server, analytics service, or third party.
- **User preferences** (threshold, toggle settings) are stored locally using `chrome.storage.local` and never leave your device.
- **No analytics, telemetry, or tracking** of any kind is included.
- **No remote code** is loaded or executed. The extension runs entirely from files bundled in the install package.

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Query, move, group, and close tabs across all windows |
| `windows` | Create new windows for domain-grouped tabs; close emptied windows |
| `storage` | Persist user preferences locally via `chrome.storage.local` |
| `tabGroups` | Create and manage Chrome tab groups within organized windows |
| `host_permissions` (`http://*/*`, `https://*/*`) | Read `tab.url` to extract the registrable domain for grouping. Without this, the extension cannot determine which domain a tab belongs to. |

## Third-Party Services

None. TabOrganizer has zero external dependencies at runtime.

## Changes

If this policy changes, the update will be posted here and the extension version will be incremented.

## Contact

For questions about this policy, email [albert@odds.trade](mailto:albert@odds.trade), join the community on [Discord](https://discord.gg/BCn4DqDMv), or open an issue at [https://github.com/chenliang87/TabOrganizer](https://github.com/chenliang87/TabOrganizer).
