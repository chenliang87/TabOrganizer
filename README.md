# TabOrganizer

A **Chrome Manifest V3 extension** that organizes the tabs in your **current Chrome Profile** into new windows:

- Groups tabs by **registrable domain (eTLD+1)** (so `mail.google.com` + `docs.google.com` → `google.com`)
- Creates a **new window per domain** when that domain has **at least N tabs** (default `N=5`)
- Moves all remaining tabs into a **single “misc”** window
- Sorts tabs inside each new window by **most recently visited first** (using `tab.lastAccessed`)
- Closes **duplicate tabs** (same URL, ignoring `#...` fragments) before organizing (keeps the most recently visited one)
- Closes **Zoom “Join Meeting” jump links** like `https://<subdomain>.zoom.us/j/...` before organizing
- Creates **Chrome tab groups** inside each new window (grouped by subdomain/hostname; falls back to base domain)
- Optionally closes old windows that become empty after moving tabs

## Install (Developer Mode)

1. In Chrome, open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder:
   - `/Users/albertgg/Desktop/TabOrganizer/extension`

Repeat the above in any other Chrome Profile where you want TabOrganizer available (extensions are installed per-profile).

## Use

1. Switch to the Chrome Profile you want to organize
2. Click the **TabOrganizer** extension icon
3. Review the preview (how many domain windows will be created, tabs going to misc)
4. Click **Organize tabs**

## Search (find + move/close/group)

In the popup, open the **Search** tab to:

- Search by **Title and/or URL**
- Use **contains** matching or **regex**
- Restrict to **current window** or **all windows**
- Run actions on matches:
  - Move matches to a new window
  - Group matches (in place)
  - Close matches
  - Close duplicates among matches
  - Close Zoom jump links among matches

## Options

Open **Options…** from the popup to configure:

- **Threshold**: “at least N tabs” per domain → gets its own window
- **Include pinned tabs**: off by default (safer)
- **Close emptied old windows**: on by default
- **Close duplicate tabs**: on by default (keeps the most recently visited one)
- **Close Zoom jump links**: on by default
- **Create tab groups**: on by default
- **Unpin tabs for grouping**: off by default (Chrome can’t group pinned tabs)

## Notes / Limitations

- **Profile-scoped**: The extension only sees/controls tabs for the Chrome Profile it’s installed in.
- **Incognito**: Not included unless you explicitly allow the extension in incognito mode from `chrome://extensions`.
- **Restricted URLs**: Some pages (e.g. `chrome://...`) may not be movable. Those are treated as “misc” and moved only if Chrome allows it.
- **Sorting**: Sorting uses `tab.lastAccessed` and is best-effort; pinned tabs (if included) keep their pinned positioning.

## Public Suffix List

The eTLD+1 logic uses a vendored copy of the Public Suffix List:

- `extension/src/lib/public_suffix_list.dat`

