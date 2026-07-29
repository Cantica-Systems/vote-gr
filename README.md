# vote-gr

Type in a Grand Rapids address, get your ward, your precinct, and where you
vote.

Live demo: **<https://votegr.cantica.dev>**

Independent and unofficial, offered with no guarantee of accuracy, and not
affiliated with the City of Grand Rapids, Kent County, or the State of
Michigan. The Michigan Voter Information Center is the official source; always
verify there, or with the Grand Rapids City Clerk, before relying on this.

Free to copy, host, revise, and change, including by a city or clerk's office.
You do not need to ask. The licence asks one thing in return: keep the
copyright notice in what you carry over.

## Why

**You cannot look up a Grand Rapids address and get its ward and precinct
without submitting personally identifying information to the State of
Michigan.**

The state's Michigan Voter Information Center is the official source and it is
accurate, but it requires you to identify yourself in order to receive your
ward, precinct and voting location. You enter your name, birth month and year,
and registration ZIP, and you must agree to a privacy notice to continue. That
notice says:

> As a public body, MDOS is subject to the Michigan Freedom of Information Act
> (FOIA), MCL 15.231 et seq., and information such as a name or address may be
> disclosed in response to a FOIA request.

In fairness to the state, the same notice says your driver's license or Social
Security number, day or month of birth, email, phone number, and decision to
register will not be shared.

That the voter file is public record is by design, and not the concern here.
The concern is what the notice does not exempt: the identifying details you
enter to run a lookup, and the fact that you looked up your voting information
at all, are not among the things it promises to withhold, so they could be
subject to FOIA. The point is not that the state is careless. It is that the
only official way to get this answer starts with handing over identifying
information and agreeing to those terms.

The Grand Rapids City Clerk defers to that state tool and, as of July 2026, has
no plans for one of its own. The city's searchable polling map still carries
2022 data from before the 74-to-59 precinct consolidation.

**This tool asks for no personal information.** You type an address, your
browser checks it against boundary files it already downloaded, and that is
the end of it. There is nothing to agree to.

That matters if you are not registered, are checking for someone else, are
considering an address you might move to, or would simply rather not hand over
your details to find out where to vote.

## What is here

Copy the `site` folder to any web host and it works. No build, no server, no
database, no account.

```
site/index.html               the page
site/lookup.css               styling
site/lookup.js                the lookup itself
site/data/precincts.geojson   the 59 precinct boundaries
site/data/polling.json        the 59 polling places
site/data/elections.json      election days and early voting windows
```

The **repository** adds the script that generated the boundary file, so the
data is not just asserted but reproducible:

```
refresh_precincts.py          regenerates precincts.geojson
requirements.txt              what that script needs
```

Your address goes to the City of Grand Rapids GIS servers to become a map
coordinate. Everything after that happens in your browser.

**We never receive your address.** It goes from your browser straight to the
city, and the precinct is worked out on your device.

What we cannot speak for, and would rather name than imply otherwise:
votegr.cantica.dev is a live demo of the tool, hosted by Cloudflare, which
serves the files, keeps its own request logs, and adds a script of its own to
the page. The city runs the address service and technically keeps the logs for
the lookup. Neither is under our control.

A copy you host yourself involves neither. The files are yours to take, host,
and redistribute, which is the point of the licence below.

Map links point at OpenStreetMap and are built from coordinates already in the
data, so no third-party geocoder is involved and nothing loads until you click.
Addresses are resolved by the city's own geocoder rather than a general one:
it is authoritative for Grand Rapids, and it offsets a result a few metres onto
the correct side of the street, which matters because precinct boundaries often
run down the middle of streets.

## The data

Each data file has a `provenance` block naming its source and how to update it.
That block is the authority if this README drifts.

### Boundaries: generated

`site/data/precincts.geojson` comes from the State of Michigan's statewide
voting precinct layer:

```
https://services3.arcgis.com/dxRQUfTDNtfqZ301/arcgis/rest/services/VotingPrecinct/FeatureServer/0
filtered to: CountyFIPS='081' AND MCDFIPS='34000'
```

Regenerate it:

```bash
pip install -r requirements.txt
python3 refresh_precincts.py
```

The script refuses to write unless the layer still returns 59 precincts,
numbered 1 to 59, in wards 1-20 / 21-40 / 41-59, with no overlapping shapes.
Geometry is thinned to about a metre, which changes no answer for any address
more than 5 m from a precinct line.

We use the state's boundaries rather than the city's because 86 pairs of the
city's polygons overlap each other, which puts roughly 1 in 100 addresses in two
precincts at once with no way to choose.

### Election days: edited by hand

`site/data/elections.json` is the calendar the banner reads:

```json
{ "date": "2026-08-04", "name": "Primary Election",
  "early_voting_from": "2026-07-25", "early_voting_to": "2026-08-02" }
```

`date` and `name` are required; the early voting fields are optional. The page
shows the first date that has not passed and ignores the rest, so an old entry
is harmless. If every date has passed it shows no election at all, which is
deliberate: nothing beats a stale date. Add the next one when it is announced.

### Polling places: edited by hand

`site/data/polling.json` is a plain list of 59 entries:

```json
"43": {
  "name": "Our Savior Lutheran Church",
  "address": "2900 BURTON ST SE, City of Grand Rapids, 49546",
  "lat": 42.926,
  "lng": -85.608
}
```

`lat` and `lng` are optional and only used to place the map link. Leave them
out of a row and everything still works; the link is simply not shown.

Sources, all published by the City Clerk:

- [August 4 2026 precinct directory (PDF)](https://www.grandrapidsmi.gov/media/xgtnucr5/082026-precinct-directory.pdf)
  is what this file was transcribed from.
- Ward maps, if you need to see the lines:
  [all city](https://www.grandrapidsmi.gov/media/kmsgoa12/voting-precincts-by-ward-all-city.pdf),
  [ward 1](https://www.grandrapidsmi.gov/media/skdfnmkl/voting-precincts-ward-i-v2.pdf),
  [ward 2](https://www.grandrapidsmi.gov/media/npbnauov/voting-precincts-ward-ii-v2.pdf),
  [ward 3](https://www.grandrapidsmi.gov/media/ps3d05gv/voting-precincts-ward-iii-v2.pdf).
- [Precinct maps and polling locations](https://www.grandrapidsmi.gov/departments/clerks-office/elections/precinct-maps-and-polling-locations/)
  is where to start each election, and the only link here worth trusting over
  time. **Every PDF URL above will break.** The city serves them under
  generated paths, and the directory has already moved once since this file was
  transcribed, keeping the same file name under a different path.
- [Kent County's Grand Rapids listing](https://www.kentcountymi.gov/418/Grand-Rapids)
  is what it was cross-checked against.

Clarifications from the City Clerk's office, confirmed by phone on 2026-07-27:

- **Precinct 9.** The city directory and the county listing disagree on it. The
  city is correct.
- **Precinct 51.** It votes at precinct 45's location while Ken-O-Sha School is
  closed. Recorded with `consolidated_with` and `note`.

Two more things that will bite you:

- **The PDF has typos.** It prints Madison as "Madion", Kalamazoo as "Kalamzoo",
  and "LaGrave" where the city's address search wants "La Grave". Those break a
  maps link, so addresses here are written as the city's search resolves them.
- **Footnotes matter.** Consolidations like precinct 51 appear only in the
  footnotes, so read them each time.

## Limits

This is an estimate. Your precinct is legally set by the state voter file, not
by a line on a map, and every result links there to confirm. Addresses within a
few metres of a precinct line are genuinely ambiguous, and the page says so.
Polling places change every election; the page names the directory in use.

## Official sources

- [Find early voting sites (State of Michigan)](https://mvic.sos.state.mi.us/Voter/Index#early-voting-search-section)
- [Grand Rapids City Clerk](https://www.grandrapidsmi.gov/departments/clerks-office/)
- [Kent County Elections](https://www.kentcountymi.gov/Departments/Elections/)

## License

Code is MIT, see [LICENSE](LICENSE). Copy, host, revise, and change it without
asking. The licence's only condition is that the copyright notice and
permission notice travel with any copy or substantial portion of it.

The data is not ours to license: boundaries are a public record of the State of
Michigan, polling places of the Grand Rapids City Clerk, both passed along as
published. Crediting them is courtesy rather than a licence term, but please
do.

Brought to you by [Cantica Systems](https://cantica.dev).
