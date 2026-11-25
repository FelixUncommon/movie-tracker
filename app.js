// ---------- Grab the bits of the page we need ----------
const form = document.getElementById("film-form");
const titleInput = document.getElementById("title");
const dateInput = document.getElementById("date");
const ratingButtons = document.getElementById("rating-buttons");
const ratingValue = document.getElementById("rating-value");
const halfButton = document.getElementById("half");
const rewatchInput = document.getElementById("rewatch");
const keyField = document.getElementById("key-field");
const keyInput = document.getElementById("key");
const saveButton = document.getElementById("save");
const statusText = document.getElementById("status");

// localStorage keeps small bits of text on this device between visits.
const KEY_STORAGE = "movieTrackerKey";

let wholePoints = null;   // 1–10, or null for no rating
let addHalf = false;

// ---------- Date: default to today ----------
// Date inputs use YYYY-MM-DD behind the scenes, even though the phone shows it your way.
function todayIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Rating: 1–10 buttons plus a ½ toggle ----------
for (let n = 1; n <= 10; n++) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = n;
  button.setAttribute("aria-pressed", "false");
  // Tapping the selected number again clears it, so a film can be saved unrated.
  button.addEventListener("click", () => { wholePoints = wholePoints === n ? null : n; showRating(); });
  ratingButtons.appendChild(button);
}

halfButton.addEventListener("click", () => { addHalf = !addHalf; showRating(); });

function currentRating() {
  if (wholePoints === null) return null;
  return wholePoints === 10 ? 10 : wholePoints + (addHalf ? 0.5 : 0);
}

function showRating() {
  [...ratingButtons.children].forEach((button, i) => {
    button.setAttribute("aria-pressed", String(i + 1 === wholePoints));
  });
  halfButton.disabled = wholePoints === null || wholePoints === 10;   // nothing to halve, and no 10.5
  halfButton.setAttribute("aria-pressed", String(addHalf && wholePoints !== null && wholePoints !== 10));
  const rating = currentRating();
  ratingValue.textContent = rating === null ? "optional" : rating;
  ratingValue.classList.toggle("unset", rating === null);   // greyed out when there's no rating
}

// ---------- The secret key ----------
function showKeyFieldIfNeeded() {
  keyField.hidden = Boolean(localStorage.getItem(KEY_STORAGE));
}

document.getElementById("forget-key").addEventListener("click", () => {
  localStorage.removeItem(KEY_STORAGE);
  keyInput.value = "";
  showKeyFieldIfNeeded();
  keyInput.focus();
});

// ---------- Saving ----------
function setStatus(message, kind = "") {
  statusText.textContent = message;
  statusText.className = kind;
}

function resetForm() {
  titleInput.value = "";
  clearSuggestion();
  dateInput.value = todayIso();
  wholePoints = null;
  addHalf = false;
  rewatchInput.checked = false;
  showRating();
}

form.addEventListener("submit", async event => {
  event.preventDefault();   // stop the browser's own form submit (which would reload the page)

  const key = localStorage.getItem(KEY_STORAGE) || keyInput.value.trim();
  const rating = currentRating();
  if (!titleInput.value.trim()) return setStatus("Add a title.", "error");
  if (!key) return setStatus("Enter your secret key.", "error");

  const film = {
    key,
    title: titleInput.value.trim(),
    date: dateInput.value,
    rating,
    rewatch: rewatchInput.checked,
    releaseYear: chosenYear   // from a TMDB suggestion, or null if typed by hand
  };

  resultCard.hidden = true;     // clear the last film's result
  saveButton.disabled = true;   // stops a double tap saving the film twice
  setStatus("Saving… (fetching TMDB details too)");

  try {
    const result = await callScript(film);
    if (!result.ok) return setStatus(result.error || "Something went wrong.", "error");

    localStorage.setItem(KEY_STORAGE, key);   // key worked, so remember it on this device
    showKeyFieldIfNeeded();
    setStatus("");
    showResult(film, result.match);

    // Add it to the saved list straight away, so it's on the Seen tab even before a refresh.
    const [y, m, d] = film.date.split("-");
    saveFilms([...loadFilms(), { id: result.recordId ?? null, t: film.title, r: film.rating, d: `${d}/${m}/${y}` }]);
    resetForm();
  } catch (err) {
    setStatus("Couldn't reach the Sheet. Check your signal and try again.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

// ---------- TMDB suggestions while typing ----------
// After you stop typing for a moment, ask the Apps Script to search TMDB and show
// up to 5 matches. Tapping one fills in TMDB's exact title and remembers its year,
// which is saved as Release Year so the scraper picks exactly that film.
const suggestionList = document.getElementById("suggestions");
const titleYear = document.getElementById("title-year");
let chosenYear = null;     // year of the tapped suggestion
let searchTimer = null;    // waits for a pause in typing
let searchNumber = 0;      // so a slow, older search can't overwrite a newer one

function clearSuggestion() {
  chosenYear = null;
  titleYear.textContent = "";
  suggestionList.hidden = true;
  suggestionList.replaceChildren();
}

titleInput.addEventListener("input", () => {
  // Typing after picking a suggestion means it no longer applies.
  chosenYear = null;
  titleYear.textContent = "";
  clearTimeout(searchTimer);
  const query = titleInput.value.trim();
  if (query.length < 3) { suggestionList.hidden = true; return; }
  searchTimer = setTimeout(() => searchTmdb(query), 500);   // half a second after the last keystroke
});

async function searchTmdb(query) {
  const key = localStorage.getItem(KEY_STORAGE);
  if (!key) return;   // no key on this device yet: just type and save as normal
  const thisSearch = ++searchNumber;
  try {
    const result = await callScript({ key, action: "search", q: query });
    if (thisSearch !== searchNumber || titleInput.value.trim() !== query) return;   // out of date
    showSuggestions(result.ok ? result.results : []);
  } catch (err) {
    suggestionList.hidden = true;   // no signal: no suggestions, saving still works
  }
}

function showSuggestions(results) {
  if (!results.length) {
    const none = Object.assign(document.createElement("li"), {
      className: "suggestion-none",
      textContent: "Not found on TMDB. You can still save it as typed."
    });
    suggestionList.replaceChildren(none);
    suggestionList.hidden = false;
    return;
  }
  suggestionList.replaceChildren(...results.map(film => {
    const item = document.createElement("li");
    const button = Object.assign(document.createElement("button"), { type: "button", className: "suggestion" });
    const poster = film.poster
      ? Object.assign(document.createElement("img"), { src: film.poster, alt: "", loading: "lazy", referrerPolicy: "no-referrer" })
      : Object.assign(document.createElement("span"), { className: "poster-blank" });
    poster.classList.add("poster");
    const text = document.createElement("span");
    text.append(
      Object.assign(document.createElement("span"), { className: "suggestion-title", textContent: film.title }),
      Object.assign(document.createElement("span"), { className: "suggestion-year", textContent: film.year || "year unknown" })
    );
    button.append(poster, text);
    button.addEventListener("click", () => {
      titleInput.value = film.title;
      chosenYear = film.year || null;
      titleYear.textContent = film.year ? `· ${film.year} on TMDB` : "· picked from TMDB";
      suggestionList.hidden = true;
    });
    item.append(button);
    return item;
  }));
  suggestionList.hidden = false;
}

// ---------- TMDB result card ----------
// After a save, say clearly whether TMDB found the film. It stays until you
// close it (or save the next film), so a problem can't flash past unnoticed.
const resultCard = document.getElementById("result");
document.getElementById("result-close").addEventListener("click", () => { resultCard.hidden = true; });

function showResult(film, match) {
  match = String(match || "").trim();
  let kind, heading, detail;
  if (match === "NO MATCH FOUND") {
    kind = "warn";
    heading = "Saved, but TMDB couldn't find it";
    detail = "Check the spelling. To fix it: correct the title in the Sheet, clear its TMDB Match cell, then run the scraper.";
  } else if (!match || match === "ERROR" || match.startsWith("TMDB lookup failed")) {
    kind = "warn";
    heading = "Saved, but the TMDB lookup failed";
    detail = "The film is in the Sheet without its details. Run the scraper from the Sheet later to fill them in.";
  } else {
    kind = "ok";
    heading = `Matched: ${match}`;
    detail = "Check the year looks right. Wrong film? In the Sheet, set its Release Year, clear TMDB Match and run the scraper.";
  }
  resultCard.className = "result " + kind;
  document.getElementById("result-icon").textContent = kind === "ok" ? "✓" : "⚠";
  document.getElementById("result-heading").textContent = heading;
  document.getElementById("result-saved").textContent = `${film.title} · ${film.rating ?? "unrated"} · saved to your Sheet`;
  document.getElementById("result-detail").textContent = detail;
  resultCard.hidden = false;
}

// ---------- Talking to the Apps Script ----------
// Used for both saving and listing. Sending the body as a plain string keeps
// this a "simple" request, which Google's servers accept from another website
// without extra checks.
async function callScript(payload) {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (result.error === "Wrong key.") {
    localStorage.removeItem(KEY_STORAGE);
    showKeyFieldIfNeeded();
  }
  return result;
}

// ---------- Tabs: Log / Seen ----------
const tabs = document.querySelectorAll(".tab[data-view]");   // Log and Seen (Stats is a link)
tabs.forEach(tab => tab.addEventListener("click", () => showView(tab.dataset.view)));

function showView(viewId) {
  document.querySelectorAll("main").forEach(view => view.hidden = view.id !== viewId);
  tabs.forEach(tab => tab.setAttribute("aria-pressed", String(tab.dataset.view === viewId)));
  window.scrollTo(0, 0);
  if (viewId === "seen-view") refreshFilms();
}

// ---------- Seen list ----------
// The list is saved on the phone, so it shows instantly; then it's refreshed from the Sheet.
const FILMS_STORAGE = "movieTrackerFilms";
const filmList = document.getElementById("film-list");
const filmCount = document.getElementById("film-count");
const listStatus = document.getElementById("list-status");
const searchInput = document.getElementById("search");

// Re-draw the list on every keystroke in the search box.
searchInput.addEventListener("input", () => renderFilms(loadFilms()));
// Pressing Search/Enter just closes the keyboard, so you can see the results.
searchInput.addEventListener("keydown", event => { if (event.key === "Enter") searchInput.blur(); });

// Lower case with accents removed, so "amelie" finds "Amélie".
function simplify(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function loadFilms() {
  try { return JSON.parse(localStorage.getItem(FILMS_STORAGE)) || []; }
  catch { return []; }
}

function saveFilms(films) {
  localStorage.setItem(FILMS_STORAGE, JSON.stringify(films));
  renderFilms(films);
}

// "DD/MM/YYYY" → 20261123, a number that sorts in date order.
function dateNumber(ukDate) {
  const [d, m, y] = String(ukDate).split("/");
  return Number(`${y}${(m || "").padStart(2, "0")}${(d || "").padStart(2, "0")}`) || 0;
}

// "23/11/2026" → "November 2026"
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function monthLabel(ukDate) {
  const [, m, y] = String(ukDate).split("/");
  return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : "Date unknown";
}

function renderFilms(films) {
  // Films arrive in Sheet order (oldest first). Reverse, then sort by date, so
  // films on the same day keep the most recently logged one at the top.
  const newestFirst = [...films].reverse().sort((a, b) => dateNumber(b.d) - dateNumber(a.d));

  // Keep only films whose title contains what's typed in the search box.
  const query = simplify(searchInput.value);
  const shown = query ? newestFirst.filter(film => simplify(film.t).includes(query)) : newestFirst;

  filmCount.textContent = !films.length ? "" : query ? `${shown.length} of ${films.length}` : films.length;
  if (query && !shown.length) {
    const none = Object.assign(document.createElement("li"), { className: "no-match", textContent: "No films match." });
    return filmList.replaceChildren(none);
  }
  // Build the list, adding a month heading (e.g. "July 2026 · 5") whenever the month changes.
  const items = [];
  let currentMonth = null;
  for (const film of shown) {
    const month = monthLabel(film.d);
    if (month !== currentMonth) {
      currentMonth = month;
      const filmsThatMonth = shown.filter(f => monthLabel(f.d) === month).length;
      const heading = Object.assign(document.createElement("li"), { className: "month-heading" });
      heading.append(
        Object.assign(document.createElement("span"), { textContent: month }),
        Object.assign(document.createElement("span"), { className: "month-count", textContent: filmsThatMonth })
      );
      items.push(heading);
    }
    const item = document.createElement("li");
    item.className = "film";
    // textContent (not innerHTML) so a title can never be treated as code.
    const title = Object.assign(document.createElement("span"), { className: "film-title", textContent: film.t });
    const rating = Object.assign(document.createElement("span"), { className: "film-rating", textContent: film.r ?? "–" });
    const date = Object.assign(document.createElement("span"), { className: "film-date", textContent: film.d });
    item.append(title, rating, date);
    item.addEventListener("click", () => openPanel(film));
    items.push(item);
  }
  filmList.replaceChildren(...items);
}

function setListStatus(message, kind = "") {
  listStatus.textContent = message;
  listStatus.className = "list-status " + kind;
}

async function refreshFilms() {
  renderFilms(loadFilms());
  const key = localStorage.getItem(KEY_STORAGE);
  if (!key) return setListStatus("Enter your key on the Log tab first.", "error");

  setListStatus("Updating…");
  try {
    const result = await callScript({ key, action: "list" });
    if (!result.ok) return setListStatus(result.error || "Couldn't load the list.", "error");
    saveFilms(result.films);
    setListStatus("");
  } catch (err) {
    setListStatus("Offline: showing the list from your last visit.", "error");
  }
}

// ---------- Film panel and deleting ----------
// Only the most recently added films can be deleted (the script checks this too).
const RECENT_LIMIT = 5;
const panel = document.getElementById("film-panel");
const confirmBox = document.getElementById("confirm");
const confirmDelete = document.getElementById("confirm-delete");
let panelFilm = null;     // the film shown in the panel
let confirmFilm = null;   // the film the "Are you sure?" box is about (fixed when it opens)

function openPanel(film) {
  panelFilm = film;
  document.getElementById("panel-title").textContent = film.t;
  document.getElementById("panel-date").textContent = `Watched ${film.d}` + (film.rw ? " · Rewatch" : "");
  fillDetails(film);
  // The films are stored in Sheet order, so the last few are the most recently added.
  const recentIds = loadFilms().slice(-RECENT_LIMIT).map(f => f.id);
  const canDelete = film.id != null && recentIds.includes(film.id);
  document.getElementById("panel-delete").hidden = !canDelete;
  panel.hidden = false;
}

// ---------- Film details in the panel ----------
// Everything comes from the saved Seen list (the script sends the details with it),
// so the panel opens instantly, even without signal.

// 1 → "1st", 2 → "2nd", 23 → "23rd", 11 → "11th"
function ordinal(n) {
  const tens = n % 100, ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  return n + suffix;
}

// Small helper: make an element with a class and some text.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fillDetails(film) {
  const box = document.getElementById("panel-details");
  const parts = [];

  // My rating and TMDB's, side by side.
  if (film.r != null || film.tm != null) {
    const scores = el("div", "scores");
    const score = (label, value) => {
      const block = el("div");
      const big = el("div", "score-value", value == null ? "–" : String(value));
      if (value != null) big.append(el("span", "score-of", " /10"));
      block.append(el("div", "score-label", label), big);
      return block;
    };
    scores.append(score("My rating", film.r), score("TMDB", film.tm == null ? null : Math.round(film.tm * 10) / 10));
    parts.push(scores);

    // How it compares: rank among my rated films, and against TMDB.
    const notes = [];
    if (film.r != null) {
      const rated = loadFilms().filter(f => f.r != null);
      const higher = rated.filter(f => f.r > film.r).length;
      const same = rated.filter(f => f.r === film.r).length;
      notes.push(`${same > 1 ? "Joint " : ""}${ordinal(higher + 1)} of ${rated.length} I've rated`);
    }
    if (film.r != null && film.tm != null) {
      const diff = Math.round((film.r - film.tm) * 10) / 10;
      notes.push(diff === 0 ? "level with TMDB" : `${Math.abs(diff)} ${diff > 0 ? "above" : "below"} TMDB`);
    }
    if (notes.length) parts.push(el("p", "score-note", notes.join(" · ")));
  }

  // TMDB details, one row each. Rows with nothing in them are skipped.
  const runtime = film.m ? `${Math.floor(film.m / 60)}h ${String(film.m % 60).padStart(2, "0")} (${film.m} mins)` : "";
  const rows = [
    ["Released", film.y || ""],
    ["Runtime", runtime],
    ["Genres", film.g || ""],
    ["Director", film.dir || ""],
    ["Starring", film.c || ""]
  ].filter(([, value]) => value !== "");

  if (rows.length) {
    const list = el("dl", "detail-rows");
    rows.forEach(([label, value]) => list.append(el("dt", "", label), el("dd", "", String(value))));
    parts.push(list);
  } else {
    parts.push(el("p", "score-note", "No TMDB details yet. They appear once the scraper has matched this film and the list refreshes."));
  }

  box.replaceChildren(...parts);
}

function closePanel() { panel.hidden = true; }

document.getElementById("panel-close").addEventListener("click", closePanel);
// Tapping the dark area outside the panel closes it too.
panel.addEventListener("click", event => { if (event.target === panel) closePanel(); });

document.getElementById("panel-delete").addEventListener("click", () => {
  confirmFilm = panelFilm;
  document.getElementById("confirm-question").textContent = `Delete ${confirmFilm.t} (${confirmFilm.d})?`;
  confirmBox.hidden = false;
});

document.getElementById("confirm-cancel").addEventListener("click", () => { confirmBox.hidden = true; });

confirmDelete.addEventListener("click", async () => {
  const film = confirmFilm;
  if (!film) return;
  const key = localStorage.getItem(KEY_STORAGE);
  confirmDelete.disabled = true;
  confirmDelete.textContent = "Deleting…";
  try {
    const result = await callScript({ key, action: "delete", id: film.id, title: film.t });
    confirmBox.hidden = true;
    closePanel();
    if (!result.ok) return setListStatus(result.error || "Couldn't delete it.", "error");
    saveFilms(loadFilms().filter(f => f.id !== film.id));
    setListStatus(`Deleted ${film.t}. It's in the Deleted tab in your Sheet.`, "ok");
  } catch (err) {
    confirmBox.hidden = true;
    setListStatus("Couldn't reach the Sheet, so nothing was deleted. Try again.", "error");
  } finally {
    confirmDelete.disabled = false;
    confirmDelete.textContent = "Delete";
  }
});

// ---------- Start ----------
resetForm();
showKeyFieldIfNeeded();
renderFilms(loadFilms());
// Coming back from the Stats page with "#seen" in the address opens the Seen tab.
if (location.hash === "#seen") showView("seen-view");
