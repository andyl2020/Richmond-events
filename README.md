# Richmond Events

A consolidated, self-hosted event guide for **Richmond, British Columbia** (Metro Vancouver — not Richmond VA, CA, Richmond Hill ON, or Richmond upon Thames).

Two views over one dataset:

- **List view** — dated events grouped by day, with ongoing runs and exhibitions separated out, and recurring weeklies in their own section.
- **Calendar view** — a month grid with everything placed on its real date, plus a strip across the top for seasons and exhibitions that span the whole month.

Every event opens a detail panel with the full description, exact times, address with a maps link, cost, contacts, every source link, and a one-click `.ics` export (recurring events export with a proper `RRULE`).

## What's in it

| | |
|---|---|
| Dated events | 29 |
| Recurring events | 13 |
| Coverage | Sep 11 – Dec 31, 2026 |
| Timezone | America/Vancouver |

Plus a **Reference** section at the bottom of the page: 32 venues, primary sources, aggregators, accounts worth following, annual events to watch for, the exclusion list, and the data-quality notes.

### Verification is visible, not hidden

Items whose time or venue was never confirmed are tagged **Unconfirmed** in every view, and their detail panel carries an explicit callout saying what is missing. Nothing invents a time to fill a gap. A softer **Verify first** callout flags claims that come from a single unofficial source — the Night Market "final season" label, the Zodiac Bar details, the Steveston Craft Fair venue during construction.

## Editing the data

All content lives in [`data/events.json`](data/events.json). No build step — edit the JSON, commit, and the site redeploys.

### A dated event

```json
{
  "id": "d-example",
  "kind": "dated",
  "title": "Event name",
  "short": "Short name for calendar pills",
  "category": "Markets",
  "tags": ["free", "market"],
  "cost": "Free",
  "free": true,
  "date": "2026-10-04",
  "endDate": "2026-10-06",
  "time": { "start": "10:00", "end": "16:00" },
  "summary": "One line shown under the title.",
  "description": "Markdown-lite: **bold**, *italic*, [links](https://example.com), `- ` lists and `> ` callouts.",
  "venue": { "name": "Venue", "address": "123 Street, Richmond BC" },
  "links": [{ "label": "Official listing", "url": "https://example.com" }]
}
```

Useful extras: `flag` (a highlighted label on the row), `performances` (an array of `{date, start}` for shows with different times each night), `extraTimes`, `hoursNote`, `organizer`, `contact`, `unverified` + `unverifiedNote`, `caution`, and `span: true` for a run or exhibition. A span longer than 3 days moves to the "ongoing" treatment; shorter ones stay on the calendar grid.

### A recurring event

```json
{
  "id": "r-example",
  "kind": "recurring",
  "title": "Weekly thing",
  "recurrence": {
    "freq": "weekly",
    "byDay": ["TU", "TH"],
    "interval": 1,
    "start": "18:00",
    "end": "20:00",
    "from": "2026-05-05",
    "until": "2026-12-22",
    "exceptions": ["2026-12-25"],
    "seasonNote": "Season runs May 5 – Dec 22, 2026."
  }
}
```

Supported rules — see [`assets/recurrence.js`](assets/recurrence.js):

| Rule | Example |
|---|---|
| Daily | `{ "freq": "daily", "interval": 2 }` |
| Weekly | `{ "freq": "weekly", "byDay": ["WE"] }` |
| Every other week | `{ "freq": "weekly", "interval": 2, "byDay": ["SA"], "from": "2026-09-05" }` |
| Nth weekday monthly | `{ "freq": "monthly", "byDay": ["TH"], "nth": [1, 3] }` (`-1` = last) |
| By date monthly | `{ "freq": "monthly", "byMonthDay": [15] }` |

If a recurring event has no confirmed schedule, give it `"recurrence": { "text": "Varies — check store socials" }` and `"unverified": true`. It renders as a card but is kept off the calendar rather than being given a made-up time.

## Running locally

`fetch()` needs a real server, so opening `index.html` from disk won't work:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Structure

```
index.html              markup and view shells
assets/styles.css       design tokens, light + dark themes
assets/recurrence.js    date helpers and recurrence expansion (no dependencies)
assets/app.js           data loading, rendering, filtering, panel, .ics export
data/events.json        all content
.github/workflows/      validates events.json, then deploys to Pages
```

No frameworks, no build step, no dependencies. Three files and a JSON blob.
