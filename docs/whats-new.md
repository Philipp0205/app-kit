# What's new: changelog entry schema

A "what's new" list is a JSON array of entries, newest first. The helpers in `frontend/ak-whats-new.js` (`AppKit.whatsNew`) read it. The kit ships no UI for it. Each app keeps its own sheet, popup or page.

## Entry

```json
[
  {
    "id": "2026-11-14-reminders",
    "date": "2026-11-14",
    "title": "Reminders before things are due",
    "bullets": [
      "You get a nudge the day before a loan is due back.",
      "Turn reminders off per item from its menu."
    ]
  },
  {
    "id": "2026-11-05",
    "date": "2026-11-05",
    "title": "Faster lists",
    "bullets": [
      "Long lists open without a pause."
    ]
  }
]
```

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | 1 to 64 characters of `a-z`, `0-9` and `-`. Unique in the list. Never reused and never renamed, because it is what a device stores as "seen". |
| `date` | string | ISO `YYYY-MM-DD`, and a real calendar day (`2026-02-30` is not). |
| `title` | string | Not blank. |
| `bullets` | string[] | At least one item, each not blank. Plain text, never HTML. Show it as text. |

Rules for the list:

- **Newest first.** The first entry is the latest release. The helpers rely on this order and never sort. A new entry goes at the top.
- **Ids are unique.** `normalizeEntries` keeps the first entry with an id and drops later ones.
- **Extra fields are dropped** by `normalizeEntries`, which returns copies with only these four.
- The ids do not need to be dates, but a date-based id (`2026-11-14`, or `2026-11-14-reminders` for a second release on a day) is easy to keep unique and in order.

## The seen id

The seen id is the id of the newest entry the person has already seen. The app stores it (in `localStorage`, or on the account) and writes `latestId(entries)` when the person closes the list.

`unseenEntries(entries, seenId)` returns every entry newer than the seen id, newest first:

| `seenId` | Result | Why |
| --- | --- | --- |
| empty, missing, or not a string | **all entries** | Nothing has been seen. An app that does not want a new account to see the whole history should write `latestId(entries)` at sign-up (loaner and Hangry skip the pile this way) instead of changing this rule. |
| the id of the newest entry | none | Up to date. |
| the id of an older entry | the entries above it | Exactly the new ones. |
| an id that is **not in the list** | **none** | The id came from a newer build than this one, or the entry was trimmed from the list. Showing nothing is the safer failure. Replaying the whole history would be worse than missing a popup. |

The two rules for an empty and an unknown id are the ones Hangry (free-now) and loaner already use. They are deliberately different: "never seen anything" is a normal state, "seen something I cannot find" is not.

`newerSeen(a, b, entries)` picks the newer of two seen ids, for an app that merges a phone and an account:

- an empty id loses to any other id, and two empty ids give `null`;
- of two known ids the one nearer the top of the list wins;
- an id that is not in the list counts as newer than any known one, the same way `unseenEntries` treats it. If both are unknown, `a` wins.

`formatEntryDate('2026-11-05')` is `"5 Nov 2026"`. With a locale, `formatEntryDate('2026-11-05', 'de')` uses `Intl`. A value that is not a real ISO day is returned as written, so a bad date never breaks the list.

## Extrablatt

Extrablatt (Java) keeps its own `src/main/resources/changelog.json`, read by `ChangelogCatalog`. The shape is different, and the kit does not ask it to change. This is the mapping, for any tool that wants to read both:

```json
{ "releases": [ { "id": "...", "date": "13 September 2026", "title": "...", "highlights": ["..."], "changes": ["..."] } ] }
```

| Extrablatt | Kit entry |
| --- | --- |
| `releases` (wrapper object) | the array itself |
| `id` | `id`, as is. All twelve current ids are already valid and unique. |
| `title` | `title` |
| `date`, a human date | `date`, as ISO. See below. |
| `highlights` and `changes` | `bullets`. See below. |

**Bullets.** `highlights` are the short lines for the new-release popup, and `changes` are the long list on the Settings page. The kit has one list. The mapping is: `bullets = highlights`, or `changes` when a release has no highlights. That is what extrablatt's own `Release.popupItems()` shows, so a popup reads the same either way. The full `changes` list stays on extrablatt's changelog page. A tool that needs everything can use `highlights` followed by `changes` instead, at the cost of repeating most points twice, since the highlights summarise the changes.

**Dates.** Parse `"13 September 2026"` as day, English month name, year and write `2026-09-13`. Two real entries have no day: `"August 2026"` (id `2026-08-20`) and `"Early August 2026"` (id `2026-08-01`). Both ids start with a full `YYYY-MM-DD` (`2026-08-20`, `2026-08-01`), so a converter can take the date from the id when the human date has no day. The id date is the only source, so it is a convention and not a check. A release whose id has no date prefix and whose date has no day cannot be converted and needs a date by hand. A converter must not guess.

**Unseen.** `ChangelogCatalog.unseenSince(lastSeenId)` is not `unseenEntries`:

- it returns **at most one release**, the latest, and an empty result when the latest equals the last-seen id. `unseenEntries` returns every entry newer than the seen id;
- an **empty** last-seen id gives the latest release, where `unseenEntries` gives all of them;
- an **unknown** last-seen id also gives the latest release (it is just "not equal to the latest"), where `unseenEntries` gives none.

So extrablatt shows one popup for the newest release, even if a person missed three. Matching the kit's "everything newer" rule would change that behaviour in the Java app and is not part of this schema. Extrablatt only needs to agree on the entry fields above if a tool ever reads its changelog.
