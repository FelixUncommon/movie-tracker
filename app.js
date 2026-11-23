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

let wholePoints = null;   // 1–10, or null until you tap one
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
  button.addEventListener("click", () => { wholePoints = n; showRating(); });
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
  halfButton.disabled = wholePoints === 10;   // there's no 10.5
  halfButton.setAttribute("aria-pressed", String(addHalf && wholePoints !== 10));
  const rating = currentRating();
  ratingValue.textContent = rating === null ? "–" : rating;
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
  if (rating === null) return setStatus("Pick a rating.", "error");
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
    // Sending the body as a plain string keeps this a "simple" request,
    // which Google's servers accept from another website without extra checks.
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(film),
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();

    if (!result.ok) {
      if (result.error === "Wrong key.") {
        localStorage.removeItem(KEY_STORAGE);
        showKeyFieldIfNeeded();
      }
      return setStatus(result.error || "Something went wrong.", "error");
    }

    localStorage.setItem(KEY_STORAGE, key);   // key worked, so remember it on this device
    showKeyFieldIfNeeded();
    const match = result.match ? ` · TMDB: ${result.match}` : "";
    setStatus(`Saved ${film.title} (${film.rating})${match}`, "ok");
    resetForm();
  } catch (err) {
    setStatus("Couldn't reach the Sheet. Check your signal and try again.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

// ---------- Start ----------
resetForm();
showKeyFieldIfNeeded();
