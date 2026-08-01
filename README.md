# Vote GR

Type in a Grand Rapids address, get your ward, your precinct, and where you
vote on Election Day. 

Live demo: **<https://votegr.cantica.dev>**

This project is independent and unofficial, offered with no guarantee of accuracy.  
This tool is not affiliated with the City of Grand Rapids, Kent County, or the State of
Michigan. The Michigan Voter Information Center is still the official source of record; always
verify there, or with the Clerk.  

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
register will not be shared, but that does not imply that your name or the fact you looked up the information, isn't.

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
browser checks it against boundary files it already downloaded, and that's 
the end of it. 

That matters if you are not registered, are checking for someone else, are
considering an address you might move to, or would simply rather not hand over
unnecessary details just to find out where to vote.

## What is here

Copy the `site` folder to any web host and it works. No build, no server, no
database, no account.

```
site/index.html               the page
site/lookup.css               styling
site/lookup.js                the lookup itself
site/data/addresses.json      every city address and the precinct it votes in
site/data/polling.json        the 59 polling places
site/data/elections.json      election days and early voting windows
site/data/precincts.geojson   the 59 precinct boundaries (a build input; the
                              page does not load it)
```

The **repository** adds the scripts that generated those files, so the data is
not just asserted but reproducible:

```
refresh_precincts.py          regenerates precincts.geojson
refresh_addresses.py          regenerates addresses.json from the above
requirements.txt              what those scripts need
```

**The address you type never leaves your browser.** There is no geocoder and
no lookup service. `addresses.json` lists every address in the city with the
precinct it votes in, worked out ahead of time, and typing searches that list
on your own device. Nothing is sent anywhere, so there is nothing for us or
anyone else to receive, log, or hand over.

What we cannot speak for, and would rather name than imply otherwise:
votegr.cantica.dev is a live demo of the tool, hosted on Cloudflare and Github, which
serves the files, keeps its own request logs, and adds a script of its own to
the page. The city runs the address service and technically keeps the logs for
the lookup. Neither is under our control.

## Data

Each data file has a `provenance` block naming its source and how to update it.
That block is the authority if this README drifts.

### Boundaries generated

`site/data/precincts.geojson` comes from the State of Michigan's statewide
voting precinct layer:

```
https://services3.arcgis.com/dxRQUfTDNtfqZ301/arcgis/rest/services/VotingPrecinct/FeatureServer/0
filtered to: CountyFIPS='081' AND MCDFIPS='34000'
```

Regenerate it with:

```bash
pip install -r requirements.txt
python3 refresh_precincts.py
```

The script refuses to write unless the layer still returns exactly 59 precincts,
numbered 1 to 59, in wards 1-20 / 21-40 / 41-59, with no overlapping shapes.
Geometry is thinned to about a meter, which changes no answer for any address
more than 5 m from a precinct line.

We use the state's boundaries rather than the city's because 86 pairs of the
city's polygons overlap each other, which puts roughly 1 in 100 addresses in two
precincts at once with no way to choose.

### Addresses generated

`site/data/addresses.json` is what makes the lookup work without a geocoder.
Every parcel address in the city, matched once to the precinct containing it:

```json
"LAFAYETTE AVE SE": [[16, "32", 60], [17, "32", 60], [24, "32", 60]]
```

The three elements are the house number, precinct, and how many meters the parcel sits from the
precinct edge (capped at 60, since past that "not near a line" is all the page
says).  A fourth element appears where an address straddles a line and lists
every precinct it touches, so the page can say it can't determine the location, rather than pick
one. A few addresses in the city are like that today.

Refresh the address file after `refresh_precincts.py`, since the precinct each parcel it 
falls in is baked in:

```bash
python3 refresh_addresses.py
```
The script reads Kent County's public parcel layer:

```
https://gis.kentcountymi.gov/agisprod/rest/services/ParcelsWithCondos/FeatureServer/0
filtered to: PROPADDRESSCITY='GRAND RAPIDS'
```

and refuses to write unless every one of the 59 precincts gains addresses and
the total is plausible. The postal city reaches well past the city limits, so
roughly a third of what it fetches falls outside and is dropped.

**Only three things per address are published: the number, the precinct, and
the distance to the edge.** This file goes to browsers,
and an address-to-owner index is not something a voting page should hand out.

Coverage is parcels, so a brand new build or an address that never had its own
parcel will be missing. Where a number is missing but the addresses either side
of it on the same side of the street agree, the page says so and uses that;
where they disagree, it says it cannot tell. It never extrapolates past the
ends of a street.

### Election days are defined by hand

`site/data/elections.json` is the calendar the banner reads:

```json
{ "date": "2026-08-04", "name": "Primary Election",
  "early_voting_from": "2026-07-25", "early_voting_to": "2026-08-02" }
```

`date` and `name` are required; the early voting fields are optional. The page
shows the first date that has not passed and ignores the rest, so an old entry
is harmless. If every date has passed it shows no election at all, which is
deliberate: nothing beats a stale date. Add the next one when it is announced.

An election may also carry early voting sites and the hours they keep:

```json
"early_voting_hours": [
  { "days": ["Mon", "Wed", "Fri", "Sat", "Sun"], "open": "9:00 AM", "close": "5:00 PM" },
  { "days": ["Tue", "Thu"], "open": "11:00 AM", "close": "7:00 PM" }
],
"early_voting_sites": [
  { "name": "GRPS University",
    "address": "1400 FULLER AVE NE, City of Grand Rapids, 49505",
    "lat": 42.990162, "lng": -85.637624 }
]
```

Hours are a weekday pattern, which is how the clerk publishes them, rather
than a row per date. `lat`, `lng` and `entrance_note` are optional, as in
`polling.json`; without coordinates the site simply shows no map link.

Any registered Grand Rapids voter may use any early voting site, so these are
not tied to a precinct. The banner names how many there are while the window
is open, and the sites themselves appear once an address has been looked up.
Leave the fields out and no sites are shown, which is what November carries
until the clerk publishes its sites.

### Polling places: edited by hand

`site/data/polling.json` is a plain list of the 59 location entries:

```json
"43": {
  "name": "Our Savior Lutheran Church",
  "address": "2900 BURTON ST SE, City of Grand Rapids, 49546",
  "lat": 42.926,
  "lng": -85.608
  "note": "Optional Note"
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

Clarifications from the City Clerk's office, confirmed on 2026-07-27 for the August 2026 election:

- **Precinct 9.** The city directory and the county listing disagreed on the location. The
  city's record was correct and Kent will update their listing. 
- **Precinct 51.** Votes at precinct 45's location while Ken-O-Sha School is
  closed. Recorded with `consolidated_with` and `note` fields.

Two more things that will bite you:

- **Footnotes matter.** Consolidations like precinct 51 appear only in the
  footnotes, so read them each time.

## Limits

This tool is an estimate. Your precinct is legally set by the state voter file, not
by a line on a map, and every result links there to confirm. Addresses within a
few metres of a precinct line are genuinely ambiguous, and the page says so, as
it does for an address that straddles a line or one it inferred from the
neighbours. Coverage is parcel addresses, so a new build may be missing
entirely. Polling places change every election; the page names the directory
in use.

## Official sources

- [Find early voting sites (State of Michigan)](https://mvic.sos.state.mi.us/Voter/Index#early-voting-search-section),
  which is where the sites in `elections.json` were read from
- [Grand Rapids early voting](https://www.grandrapidsmi.gov/departments/clerks-office/elections/early-voting/),
  the clerk's page, which is where the hours were read from
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
