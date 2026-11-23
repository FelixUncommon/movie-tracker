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
    rewatch: rewatchInput.checked
  };

  saveButton.disabled = true;   // stops a double tap saving the film twice
  setStatus("Saving… (fetching TMDB details too)");

  try {
    const result = await callScript(film);
    if (!result.ok) return setStatus(result.error || "Something went wrong.", "error");

    localStorage.setItem(KEY_STORAGE, key);   // key worked, so remember it on this device
    showKeyFieldIfNeeded();
    const match = result.match ? ` · TMDB: ${result.match}` : "";
    setStatus(`Saved ${film.title} (${film.rating ?? "unrated"})${match}`, "ok");

    // Add it to the saved list straight away, so it's on the Seen tab even before a refresh.
    const [y, m, d] = film.date.split("-");
    saveFilms([...loadFilms(), { t: film.title, r: film.rating, d: `${d}/${m}/${y}` }]);
    resetForm();
  } catch (err) {
    setStatus("Couldn't reach the Sheet. Check your signal and try again.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

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
const tabs = document.querySelectorAll(".tab");
tabs.forEach(tab => tab.addEventListener("click", () => showView(tab.dataset.view)));

function showView(viewId) {
  document.getElementById("log-view").hidden = viewId !== "log-view";
  document.getElementById("seen-view").hidden = viewId !== "seen-view";
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
  filmList.replaceChildren(...shown.map(film => {
    const item = document.createElement("li");
    // textContent (not innerHTML) so a title can never be treated as code.
    const title = Object.assign(document.createElement("span"), { className: "film-title", textContent: film.t });
    const rating = Object.assign(document.createElement("span"), { className: "film-rating", textContent: film.r ?? "–" });
    const date = Object.assign(document.createElement("span"), { className: "film-date", textContent: film.d });
    item.append(title, rating, date);
    return item;
  }));
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

// ---------- Start ----------
resetForm();
showKeyFieldIfNeeded();
renderFilms(loadFilms());
