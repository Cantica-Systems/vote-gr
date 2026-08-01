// Grand Rapids Precinct Lookup
// https://github.com/Cantica-Systems/vote-gr
// Copyright (c) 2026 Cantica Systems LLC. MIT licensed.

(function () {
  "use strict";

  const NEAR_M = 10;              // how close to a precinct line counts as "too close to be certain"
  const MAX_SUGGESTIONS = 6;

  const $ = (id) => document.getElementById(id);
  const input = $("addr"), optionList = $("opts"), statusLine = $("status"), resultBox = $("result");

  // The whole lookup is a dictionary hit against a file the page already
  // downloaded. There is no geocoder and no request: the address you type is
  // never sent anywhere, and a city or county server going down cannot stop
  // this working. See refresh_addresses.py for how the index is built.
  let streets = {};     // { "LAFAYETTE AVE SE": [[number, precinct, metresFromEdge, [rivals]?] ] }
  let streetNames = []; // the keys, for matching what someone types
  let wards = {};       // { "32": 2 }
  let polling = {};     // { "43": { name, address, lat, lng, ... } }
  let election = null;  // the next election, or null once every date has passed
  let suggestions = [];
  let active = -1;      // highlighted suggestion, -1 for none

  // Build an element. Extra arguments become children; strings become text.
  const el = (tag, cls, ...children) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const child of children) if (child != null) node.append(child);
    return node;
  };

  const say = (message, isError) => {
    statusLine.className = isError ? "status err" : "status";
    statusLine.textContent = message || "";
  };

  const clearResult = () => { resultBox.textContent = ""; };

  const getJSON = async (url) => {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  // A map link built straight from coordinates, so no geocoding service is
  // involved and nothing loads until someone clicks it.
  const osmLink = (lat, lng) =>
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

  // ---- matching what someone types against the index --------------------

  // "1951 Lafayette Ave. SE" -> { number: 1951, rest: "LAFAYETTE AVE SE" }
  function parseTyped(text) {
    const clean = text.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
    const match = clean.match(/^(\d+)\s*(.*)$/);
    return match ? { number: Number(match[1]), rest: match[2] }
                 : { number: null, rest: clean };
  }

  // Every typed word must begin a word of the street name, in order. So
  // "lafayette se" finds "LAFAYETTE AVE SE" without the typist having to know
  // we spell it AVE, while "se lafayette" does not match SEWARD.
  function streetMatches(street, tokens) {
    const words = street.split(" ");
    let at = 0;
    for (const token of tokens) {
      while (at < words.length && !words[at].startsWith(token)) at++;
      if (at >= words.length) return false;
      at++;
    }
    return true;
  }

  function matchingStreets(rest) {
    const tokens = rest.split(" ").filter(Boolean);
    if (!tokens.length) return [];
    const hits = streetNames.filter((s) => streetMatches(s, tokens));
    // A street whose first word is what they started typing comes first;
    // after that, shorter names, which are the less surprising answer.
    return hits.sort((a, b) => {
      const lead = (s) => (s.startsWith(tokens[0]) ? 0 : 1);
      return lead(a) - lead(b) || a.length - b.length || a.localeCompare(b);
    });
  }

  // ---- resolving a house number on a street -----------------------------

  // Addresses come from parcels, so a number can be missing: a new build, or
  // something that never had its own parcel. Rather than guess, we answer
  // only when the neighbours on the same side of the street agree, and say so
  // when they do not. Same side matters because a precinct line often runs
  // down the middle of a street, putting odd and even in different precincts.
  function resolve(street, number) {
    const rows = streets[street];
    if (!rows) return null;

    const exact = rows.find((r) => r[0] === number);
    if (exact) {
      return { precinct: exact[1], edgeMetres: exact[2], rivals: exact[3] || null,
               inferred: false };
    }

    const sameSide = rows.filter((r) => r[0] % 2 === number % 2);
    let below = null, above = null;
    for (const row of sameSide) {
      if (row[0] < number) below = row;
      else if (row[0] > number) { above = row; break; }
    }
    if (!below || !above) return null;          // outside the known range: do not extrapolate
    if (below[1] !== above[1]) {
      return { precinct: below[1], rivals: [below[1], above[1]], inferred: true,
               edgeMetres: Infinity };
    }
    return { precinct: below[1], edgeMetres: Math.min(below[2], above[2]),
             rivals: null, inferred: true };
  }

  // ---- rendering --------------------------------------------------------

  const advisory = (kind, text) => {
    const node = el("div", "advisory", text);
    node.dataset.kind = kind;
    return node;
  };

  const mapLink = (lat, lng) => {
    const link = el("a", "btn", "See it on a map");
    link.rel = "noopener";
    link.target = "_blank";
    link.href = osmLink(lat, lng);
    return link;
  };

  function pollingPlace(precinct, place) {
    if (!place) {
      return [el("div", "advisory",
        `We do not have a polling place listed for precinct ${precinct}. ` +
        "Please check the Michigan Voter Information Center.")];
    }
    const parts = [
      // Named with the date, so the voting day location and the early voting
      // sites below it each say plainly which day they are for.
      el("div", "lead-2", election
        ? `Your voting day location, ${prettyDate(election.date)}`
        : "Your voting day location"),
      el("div", "place", place.name),
      el("div", "addr", place.address),
      place.entrance_note ? el("div", "note", place.entrance_note) : null,
    ];
    if (place.consolidated_with) {
      parts.push(advisory("consolidated",
        `For this election, precinct ${precinct} votes at precinct ` +
        `${place.consolidated_with}'s location${place.note ? `. ${place.note}.` : "."}`));
    }
    if (place.lat != null && place.lng != null) parts.push(mapLink(place.lat, place.lng));
    return parts;
  }

  function render(found, resolvedAddress) {
    const { precinct, edgeMetres, rivals, inferred } = found;
    // True when any of the three uncertainty advisories below will fire.
    const uncertain = Boolean(rivals || inferred || edgeMetres <= NEAR_M);
    const body = el("div", "card-body",
      el("div", "lead", "For your address, ", el("span", "addr-quote", `“${resolvedAddress}”`), ","),
      el("div", "ward",
        el("span", "wp-label", "Ward:"), el("span", "wp-value", String(wards[precinct])),
        el("span", "wp-label", "Precinct:"), el("span", "wp-value", String(precinct))),
      ...pollingPlace(precinct, polling[String(precinct)]),

      // Said plainly rather than buried: an address that straddles a line, or
      // that we only inferred from its neighbours, is a guess and should be
      // checked. This is the whole reason the page exists, so it would be
      // perverse to hide it.
      rivals ? advisory("ambiguous",
        `This address sits where precincts ${rivals.join(" and ")} meet, so we ` +
        "cannot tell which one it votes in. Please check with the city clerk or " +
        "the Michigan Voter Information Center.") : null,
      !rivals && inferred ? advisory("inferred",
        "We do not have this exact address, so this is taken from the addresses " +
        "either side of it on the same side of the street. They agree, but it is " +
        "worth confirming.") : null,
      !rivals && edgeMetres <= NEAR_M ? advisory("boundary",
        `This address sits about ${Math.round(edgeMetres)} m from the edge of the ` +
        "precinct, which is too close to be certain. Please check with the city " +
        "clerk or the Michigan Voter Information Center.") : null,

      // Last, so the advisories stay next to the precinct answer they qualify.
      ...earlyVoting(uncertain));

    clearResult();
    resultBox.append(el("div", "card", body));
  }


  const failed = (message) => {
    clearResult();
    say(`${message} You can read the city's precinct directory directly, or check the ` +
        "Michigan Voter Information Center.", true);
  };

  // ---- suggestions ------------------------------------------------------

  function closeList() {
    optionList.textContent = "";
    input.setAttribute("aria-expanded", "false");
    active = -1;
  }

  function renderList() {
    optionList.textContent = "";
    suggestions.forEach((suggestion, i) => {
      const option = el("li", null, suggestion.text);
      option.id = `opt-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", i === active ? "true" : "false");
      option.addEventListener("mousedown", (event) => { event.preventDefault(); choose(i); });
      optionList.append(option);
    });
    input.setAttribute("aria-expanded", suggestions.length ? "true" : "false");
  }

  function suggest(text) {
    const { number, rest } = parseTyped(text);
    const matches = matchingStreets(rest);

    // With a number, offer the full address, but only where we can actually
    // answer it. Without one, offer street names to finish first.
    suggestions = number === null
      ? matches.slice(0, MAX_SUGGESTIONS).map((street) => ({ text: street, street }))
      : matches.filter((street) => resolve(street, number))
               .slice(0, MAX_SUGGESTIONS)
               .map((street) => ({ text: `${number} ${street}`, street, number }));

    active = -1;
    renderList();
    say(suggestions.length ? "" : notFoundHint(number, matches.length));
  }

  const notFoundHint = (number, streetHits) => {
    if (number === null) return "No street found. Try the street name, like Monroe Ave NW.";
    if (streetHits) return `We have no number ${number} on that street. Check the number, ` +
                           "or look it up at the Michigan Voter Information Center.";
    return "No address found. Try the number and the direction, like 300 Monroe Ave NW. " +
           "Addresses outside the city are not listed here.";
  };

  function choose(index) {
    const picked = suggestions[index];
    if (!picked) return;

    // A street on its own is half an address: put it in the box and wait.
    if (picked.number == null) {
      input.value = `${picked.street} `;
      closeList();
      say("Now add the house number.");
      input.focus();
      return;
    }

    input.value = picked.text;
    closeList();
    clearResult();
    const found = resolve(picked.street, picked.number);
    if (!found) return failed("We do not have that address.");
    say("");
    render(found, picked.text);
  }

  // No debounce: the index is already in memory, so this is a dictionary
  // lookup rather than a request, and waiting would only add lag.
  input.addEventListener("input", () => {
    const text = input.value.trim();
    clearResult();
    say("");
    if (text.length < 3) return closeList();
    suggest(text);
  });

  input.addEventListener("keydown", (event) => {
    if (!suggestions.length) return;
    const move = (step) => {
      event.preventDefault();
      const count = suggestions.length;
      // Nothing highlighted yet: down goes to the first, up to the last.
      active = active < 0 ? (step > 0 ? 0 : count - 1)
                          : (active + step + count) % count;
      renderList();
    };
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") { event.preventDefault(); choose(active >= 0 ? active : 0); }
    else if (event.key === "Escape") closeList();
  });

  // ---- next election ----------------------------------------------------
  // Shows the first date that has not passed and hides the rest, so a stale
  // entry is harmless while a missing one simply shows nothing.

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // The clerk publishes early voting hours as a weekday pattern rather than as
  // dated rows, so hours are matched by weekday. Indexes line up with DAYS.
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];

  const todayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` +
           `-${String(now.getDate()).padStart(2, "0")}`;
  };

  const prettyDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return `${DAYS[date.getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
  };

  const nextElection = (elections) => {
    const today = todayISO();
    return (elections || []).find((e) => e.date >= today) || null;
  };

  function showNextElection(next) {
    const banner = $("election");
    if (!banner || !next) return;

    banner.append("Next election: ", el("strong", null, `${next.name}, ${prettyDate(next.date)}`));

    const today = todayISO();
    const { early_voting_from: from, early_voting_to: to } = next;
    if (from && to && today <= to) {
      // The count, not the addresses. Addresses appear once an address has been
      // looked up, not to everyone who loads the page.
      const count = (next.early_voting_sites || []).length;
      const where = count ? `, at ${count} site${count === 1 ? "" : "s"} across the city` : "";
      banner.append(el("span", "ev", today >= from
        ? `Early voting is open now, through ${prettyDate(to)}${where}.`
        : `Early voting runs from ${prettyDate(from)} through ${prettyDate(to)}${where}.`));
    }
    banner.hidden = false;
  }

  const hoursFor = (hours, abbr) =>
    (hours || []).find((rule) => (rule.days || []).includes(abbr)) || null;

  // Early voting, shown while the next election carries sites and the window
  // has not closed. Returns an empty array otherwise, so render can spread it
  // without a conditional. Once the window passes this goes quiet on its own,
  // with no edit to make and nothing to remember.
  function earlyVoting(uncertain) {
    if (!election) return [];
    const { early_voting_from: from, early_voting_to: to,
            early_voting_sites: sites, early_voting_hours: hours } = election;
    if (!from || !to || !(sites || []).length) return [];

    const today = todayISO();
    if (today > to) return [];
    const open = today >= from;

    const parts = [];

    // Said first, because for an address we could not place with certainty this
    // is the answer: every site holds the voter's registration, so which
    // precinct wins stops mattering.
    if (uncertain) {
      parts.push(advisory("early-voting",
        "Vote early and verify there. All early voting locations have your information."));
    }

    // Same shape as the voting day heading above it: what it is, then when.
    parts.push(el("div", "lead-2", open
      ? `Vote early, through ${prettyDate(to)}`
      : `Vote early, ${prettyDate(from)} through ${prettyDate(to)}`));
    parts.push(el("div", "ev-hours",
      "Any Grand Rapids voter may use any of these, whatever precinct they are in."));

    const todayRule = open ? hoursFor(hours, DAY_ABBR[new Date().getDay()]) : null;
    if (todayRule) {
      parts.push(el("div", "ev-hours", `Open today, ${todayRule.open} to ${todayRule.close}.`));
    }
    for (const rule of hours || []) {
      parts.push(el("div", "ev-hours",
        `${rule.days.join(", ")}: ${rule.open} to ${rule.close}.`));
    }

    for (const site of sites) {
      const row = el("div", "ev-site",
        el("div", "place", site.name),
        el("div", "addr", site.address),
        site.entrance_note ? el("div", "note", site.entrance_note) : null);
      // The same button the voting day location gets, so a site reads the same
      // wherever it appears on the card.
      if (site.lat != null && site.lng != null) row.append(mapLink(site.lat, site.lng));
      parts.push(row);
    }

    return [el("div", "ev-block", ...parts)];
  }

  // ---- clicks outside the suggestion list close it ------------------------

  document.addEventListener("click", (event) => {
    if (!optionList.contains(event.target) && event.target !== input) closeList();
  });

  // ---- boot -------------------------------------------------------------

  (async () => {
    input.disabled = true;
    say("Loading...");
    try {
      const [addresses, places, calendar] = await Promise.all([
        getJSON("data/addresses.json"),
        getJSON("data/polling.json"),
        getJSON("data/elections.json"),
      ]);

      streets = addresses.streets;
      streetNames = Object.keys(streets);
      wards = addresses.wards;
      polling = places.precincts;
      election = nextElection(calendar.elections);
      showNextElection(election);

      // Read the dates off the data itself. A hand-edited data file and a
      // hard-coded footer drift apart; this cannot.
      const generated = (addresses.provenance || {}).generated;
      const directory = (places.provenance || {}).source_document;
      const sources = $("sources");
      if (sources) {
        sources.textContent =
          "Precinct boundaries from the State of Michigan, matched to Kent County " +
          `parcel addresses${generated ? ` on ${generated}` : ""}.` +
          ` Polling places from the ${directory || "City Clerk's precinct directory"}.`;
      }

      input.disabled = false;
      say("");
    } catch {
      say("Could not load the precinct data files. If you are hosting this yourself, " +
          "check that the data folder sits next to this page.", true);
    }
  })();
})();
