// Grand Rapids Precinct Lookup
// https://github.com/Cantica-Systems/vote-gr
// Copyright (c) 2026 Cantica Systems LLC. MIT licensed.

(function () {
  "use strict";

  const GEOCODER = "https://maps.grcity.us/arcgis/rest/services/Geocode/Transport_StreetCenterlines/GeocodeServer";
  const NEAR_M = 10;              // how close to a precinct line counts as "too close to be certain"
  const M_PER_DEG_LAT = 111320;
  const LNG_SCALE = Math.cos(42.96 * Math.PI / 180);   // longitude shrinks at this latitude

  const $ = (id) => document.getElementById(id);
  const input = $("addr"), optionList = $("opts"), statusLine = $("status"), resultBox = $("result");

  let precincts = [];   // [{ ward, precinct, polys }]
  let polling = {};     // { "43": { name, address, lat, lng, ... } }
  let suggestions = [];
  let active = -1;      // highlighted suggestion, -1 for none
  let debounce = null;
  let latestQuery = 0;  // guards against a slow response overwriting a newer one

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

  // ArcGIS reports its own failures as HTTP 200 with an error body, so a
  // stopped service looks like a successful empty answer unless we check.
  // Without this, "the city's server is down" reads to the user as "your
  // address is wrong".
  const arcgis = async (endpoint, params) => {
    const data = await getJSON(`${GEOCODER}/${endpoint}?${new URLSearchParams(params)}`);
    if (data && data.error) throw new Error(data.error.message || "geocoder error");
    return data;
  };

  // A map link built straight from coordinates, so no geocoding service is
  // involved and nothing loads until someone clicks it.
  const osmLink = (lat, lng) =>
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

  // ---- geometry ---------------------------------------------------------
  // Ray casting against the bundled boundaries. Nothing about the address
  // leaves the browser at this stage; the lookup itself is entirely local.

  const ringsOf = (geometry) =>
    geometry.type === "Polygon" ? [geometry.coordinates] :
    geometry.type === "MultiPolygon" ? geometry.coordinates : [];

  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ring[0] is the outer boundary; any further rings are holes.
  const inPolygon = (lng, lat, polygon) =>
    inRing(lng, lat, polygon[0]) &&
    !polygon.slice(1).some((hole) => inRing(lng, lat, hole));

  const locate = (lng, lat) =>
    precincts.find((p) => p.polys.some((poly) => inPolygon(lng, lat, poly)));

  function metresToSegment(lng, lat, a, b) {
    const x = (lng - a[0]) * LNG_SCALE, y = lat - a[1];
    const dx = (b[0] - a[0]) * LNG_SCALE, dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, (x * dx + y * dy) / len2)) : 0;
    return Math.hypot(x - t * dx, y - t * dy) * M_PER_DEG_LAT;
  }

  function metresToEdge(lng, lat, feature) {
    let best = Infinity;
    for (const poly of feature.polys) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          best = Math.min(best, metresToSegment(lng, lat, ring[j], ring[i]));
        }
      }
    }
    return best;
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
      el("div", "lead-2", "Your voting day location is at"),
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

  function render(feature, resolvedAddress, edgeMetres) {
    const body = el("div", "card-body",
      el("div", "lead", "For your address, ", el("span", "addr-quote", `“${resolvedAddress}”`), ","),
      el("div", "ward",
        el("span", "wp-label", "Ward:"), el("span", "wp-value", String(feature.ward)),
        el("span", "wp-label", "Precinct:"), el("span", "wp-value", String(feature.precinct))),
      ...pollingPlace(feature.precinct, polling[String(feature.precinct)]),
      edgeMetres <= NEAR_M ? advisory("boundary",
        `This address sits about ${Math.round(edgeMetres)} m from the edge of the ` +
        "precinct, which is too close to be certain. Please check with the city " +
        "clerk or the Michigan Voter Information Center.") : null);

    clearResult();
    resultBox.append(el("div", "card", body));
  }

  function outsideCity() {
    const mvic = el("a", null, "Michigan Voter Information Center");
    mvic.href = "https://mvic.sos.state.mi.us/";
    mvic.rel = "noopener";
    clearResult();
    resultBox.append(el("div", "card",
      el("div", "card-body",
        el("div", "place", "That address is outside Grand Rapids city limits."),
        el("div", "addr",
          "Kent County lists polling places for other jurisdictions, and the ", mvic,
          " covers the whole state."))));
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

  async function suggest(text) {
    const mine = ++latestQuery;
    try {
      const data = await arcgis("suggest", { text, f: "json" });
      if (mine !== latestQuery) return;
      suggestions = (data.suggestions || []).slice(0, 6);
      active = -1;
      renderList();
      say(suggestions.length ? ""
        : "No address found. Try including the number and direction, like 300 Monroe Ave NW.");
    } catch {
      if (mine !== latestQuery) return;
      closeList();
      say("Could not reach the address service. You can read the city's precinct " +
          "directory directly, or check the Michigan Voter Information Center.", true);
    }
  }

  async function choose(index) {
    const picked = suggestions[index];
    if (!picked) return;
    input.value = picked.text;
    closeList();
    clearResult();
    say("Looking up your address...");
    try {
      const data = await arcgis("findAddressCandidates",
        { magicKey: picked.magicKey, outSR: 4326, f: "json" });
      const candidate = (data.candidates || [])[0];
      if (!candidate) throw new Error("no candidates");
      const { x: lng, y: lat } = candidate.location;
      const feature = locate(lng, lat);
      say("");
      if (!feature) return outsideCity();
      render(feature, candidate.address, metresToEdge(lng, lat, feature));
    } catch {
      failed("Could not look that address up.");
    }
  }

  input.addEventListener("input", () => {
    const text = input.value.trim();
    clearResult();
    say("");
    clearTimeout(debounce);
    if (text.length < 3) return closeList();
    debounce = setTimeout(() => suggest(text), 220);
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

  function showNextElection(elections) {
    const banner = $("election");
    const today = todayISO();
    const next = (elections || []).find((e) => e.date >= today);
    if (!banner || !next) return;

    banner.append("Next election: ", el("strong", null, `${next.name}, ${prettyDate(next.date)}`));

    const { early_voting_from: from, early_voting_to: to } = next;
    if (from && to && today <= to) {
      banner.append(el("span", "ev", today >= from
        ? `Early voting is open now, through ${prettyDate(to)}.`
        : `Early voting runs from ${prettyDate(from)} through ${prettyDate(to)}.`));
    }
    banner.hidden = false;
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
      const [boundaries, places, calendar] = await Promise.all([
        getJSON("data/precincts.geojson"),
        getJSON("data/polling.json"),
        getJSON("data/elections.json"),
      ]);

      precincts = boundaries.features.map((f) => ({
        ward: f.properties.ward,
        precinct: f.properties.precinct,
        polys: ringsOf(f.geometry),
      }));
      polling = places.precincts;
      showNextElection(calendar.elections);

      // Read the dates off the data itself. A hand-edited data file and a
      // hard-coded footer drift apart; this cannot.
      const edited = (boundaries.provenance || {}).source_last_edited;
      const directory = (places.provenance || {}).source_document;
      const sources = $("sources");
      if (sources) {
        sources.textContent =
          `Precinct boundaries from the State of Michigan${edited ? `, last updated ${edited}` : ""}.` +
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
