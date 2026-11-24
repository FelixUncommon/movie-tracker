// Movie tracker: lets the phone app add a film to the "Raw" tab, and list the films seen so far.
//
// This goes in the SAME Apps Script project as the TMDB scraper (the Sheet's
// Extensions → Apps Script), as a second file next to Code.gs. Being in the
// same project means it can call populateMovieData() straight after adding
// the row, so the TMDB details appear within seconds.
//
// This file is a backup kept in Git. The live copy is in the Sheet.
//
// Security: the web app URL is reachable by anyone who has it, so every
// request must include the secret key saved in Script Properties as
// TRACKER_KEY. The key is never in this file or in the phone app's code.

const TRACKER_TAB = "Raw";

// Visiting the web app URL in a browser shows this: a quick "is it live?" check.
function doGet() {
  return reply_({ ok: true, message: "Movie tracker is running." });
}

// Every request from the phone app arrives here. It always includes the key,
// plus an "action": "list" asks for the films seen so far, "csv" asks for the
// whole Raw tab (for the dashboard), "delete" removes a recent film, "search" looks up
// TMDB while you type; anything else adds a film.
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: "Couldn't read the request." });
  }

  // Check the secret key before doing anything else.
  const key = PropertiesService.getScriptProperties().getProperty("TRACKER_KEY");
  if (!key || data.key !== key) {
    return reply_({ ok: false, error: "Wrong key." });
  }

  if (data.action === "list") return listFilms_();
  if (data.action === "csv") return csvOfRawTab_();
  if (data.action === "delete") return deleteFilm_(data);
  if (data.action === "search") return searchTmdb_(data);
  return addFilm_(data);
}

// Sends back the whole Raw tab as CSV text, exactly as the Sheet shows it
// (same as File → Download → CSV), so the dashboard's own CSV reader works unchanged.
function csvOfRawTab_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TRACKER_TAB);
    if (!sheet) throw new Error('Worksheet "' + TRACKER_TAB + '" not found.');
    const rows = sheet.getDataRange().getDisplayValues();
    // Cells containing a comma, quote or line break are wrapped in quotes ("" = a literal quote).
    const quote = cell => /[",\n\r]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
    const csv = rows.map(row => row.map(quote).join(",")).join("\n");
    return reply_({ ok: true, csv: csv });
  } catch (err) {
    return reply_({ ok: false, error: String(err.message || err) });
  }
}

// Sends back every film as { id: Record ID, t: title, r: rating, d: "DD/MM/YYYY" }, in Sheet order.
// Short names keep the reply small, which matters on a weak phone signal.
function listFilms_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TRACKER_TAB);
    if (!sheet) throw new Error('Worksheet "' + TRACKER_TAB + '" not found.');
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h).trim());
    const at = name => {
      const index = headers.indexOf(name);
      if (index === -1) throw new Error("Missing column: " + name);
      return index;
    };
    const titleAt = at("Movie Title"), ratingAt = at("Rating"), dateAt = at("Date Watched");
    const idAt = at("Record ID");
    const timeZone = Session.getScriptTimeZone();

    const films = values.slice(1)
      .filter(row => String(row[titleAt]).trim() !== "")
      .map(row => {
        const date = row[dateAt];
        return {
          id: row[idAt] === "" ? null : Number(row[idAt]),
          t: String(row[titleAt]).trim(),
          r: row[ratingAt] === "" ? null : Number(row[ratingAt]),
          d: date instanceof Date ? Utilities.formatDate(date, timeZone, "dd/MM/yyyy") : String(date)
        };
      });
    return reply_({ ok: true, films: films });
  } catch (err) {
    return reply_({ ok: false, error: String(err.message || err) });
  }
}

// data is: { key, title, date: "YYYY-MM-DD", rating (or null if unrated), rewatch,
//            releaseYear (optional: from a TMDB suggestion, so the scraper picks that film) }
function addFilm_(data) {
  // 1. Check the film details make sense.
  const title = String(data.title || "").trim();
  const unrated = data.rating === null || data.rating === undefined || data.rating === "";
  const rating = unrated ? "" : Number(data.rating);   // "" leaves the Rating cell blank
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.date || ""));
  if (!title) return reply_({ ok: false, error: "Title is missing." });
  if (!dateParts) return reply_({ ok: false, error: "Date is missing." });
  if (!unrated && (!(rating >= 0 && rating <= 10) || (rating * 2) % 1 !== 0)) {
    return reply_({ ok: false, error: "Rating must be 0–10 in half points." });
  }
  const [, year, month, day] = dateParts;

  // 2. Add the row. The lock stops two saves at once from grabbing the same row.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let sheet, newRow, col;
  let movieId, savedRecordId;
  try {
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TRACKER_TAB);
    if (!sheet) throw new Error('Worksheet "' + TRACKER_TAB + '" not found.');

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    col = name => {
      const index = headers.indexOf(name);
      if (index === -1) throw new Error("Missing column: " + name);
      return index + 1;
    };

    // Find the last row that has a title (formulas further down don't count).
    const dataRows = Math.max(sheet.getLastRow() - 1, 1);
    const columnValues = name => sheet.getRange(2, col(name), dataRows, 1).getValues().map(r => r[0]);
    const titles = columnValues("Movie Title");
    let lastFilled = titles.length;
    while (lastFilled > 0 && String(titles[lastFilled - 1]).trim() === "") lastFilled--;
    const prevRow = lastFilled + 1;   // sheet row number of the last film
    newRow = prevRow + 1;

    // Next IDs: the highest so far plus one (Movie ID and Record ID are counted separately).
    const nextId = name => Math.max(0, ...columnValues(name).map(Number).filter(n => !isNaN(n))) + 1;
    movieId = nextId("Movie ID");
    const recordId = nextId("Record ID");

    // Copy the previous row's formatting (date format, number formats and so on).
    if (prevRow > 1) {
      sheet.getRange(prevRow, 1, 1, lastCol).copyTo(
        sheet.getRange(newRow, 1, 1, lastCol),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }

    // Date Watched: store it the same way as the row above (real date or text).
    const prevDate = prevRow > 1 ? sheet.getRange(prevRow, col("Date Watched")).getValue() : null;
    const dateValue = prevDate instanceof Date
      ? new Date(Number(year), Number(month) - 1, Number(day), 12)   // midday avoids time-zone slips
      : day + "/" + month + "/" + year;

    sheet.getRange(newRow, col("Movie ID")).setValue(movieId);
    sheet.getRange(newRow, col("Movie Title")).setValue(title);
    sheet.getRange(newRow, col("Rating")).setValue(rating);
    sheet.getRange(newRow, col("Date Watched")).setValue(dateValue);
    sheet.getRange(newRow, col("Year Watched")).setValue(Number(year));
    sheet.getRange(newRow, col("Rewatch?")).setValue(data.rewatch ? "Yes" : "No");
    // The scraper prefers the TMDB result whose year matches Release Year,
    // so filling it in from the chosen suggestion makes it pick the right film.
    if (/^\d{4}$/.test(String(data.releaseYear || ""))) {
      sheet.getRange(newRow, col("Release Year")).setValue(Number(data.releaseYear));
    }
    sheet.getRange(newRow, col("Record ID")).setValue(recordId);
    savedRecordId = recordId;

    // vs TMDB is a formula (e.g. =C2-Q2). Copying it down adjusts it to the new row.
    const vsCell = sheet.getRange(newRow, col("vs TMDB"));
    const prevVs = sheet.getRange(prevRow, col("vs TMDB"));
    if (!vsCell.getFormula() && prevVs.getFormula()) prevVs.copyTo(vsCell);

    SpreadsheetApp.flush();
  } catch (err) {
    return reply_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }

  // 3. Run the TMDB scraper now. If TMDB fails, the film is still saved.
  let match = "";
  try {
    populateMovieData();
    match = String(sheet.getRange(newRow, col("TMDB Match")).getValue());
  } catch (err) {
    match = "TMDB lookup failed: " + (err.message || err);
  }

  return reply_({ ok: true, row: newRow, movieId: movieId, recordId: savedRecordId, match: match });
}

// Looks up a title on TMDB for the suggestions under the Title box.
// Uses the same search and token (Script Properties → TMDB_TOKEN) as the scraper.
// Sends back up to 5 films: { title, year, poster (small image address, or null) }.
function searchTmdb_(data) {
  const query = String(data.q || "").trim();
  if (query.length < 2) return reply_({ ok: true, results: [] });
  try {
    const token = PropertiesService.getScriptProperties().getProperty("TMDB_TOKEN");
    if (!token) throw new Error("TMDB_TOKEN is missing from Script Properties.");
    const response = UrlFetchApp.fetch(
      "https://api.themoviedb.org/3/search/movie?include_adult=false&query=" + encodeURIComponent(query),
      { headers: { Authorization: "Bearer " + token, accept: "application/json" }, muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) throw new Error("TMDB HTTP " + response.getResponseCode());
    const results = (JSON.parse(response.getContentText()).results || []).slice(0, 5).map(movie => ({
      title: movie.title,
      year: movie.release_date ? movie.release_date.substring(0, 4) : "",
      poster: movie.poster_path ? "https://image.tmdb.org/t/p/w92" + movie.poster_path : null
    }));
    return reply_({ ok: true, results: results });
  } catch (err) {
    return reply_({ ok: false, error: String(err.message || err) });
  }
}

// Deletes one of the most recently added films. Several safety checks:
//  - only the last RECENT_LIMIT films with a title can be deleted (older ones: use the Sheet);
//  - the row is found by Record ID, and its title must match too (so a stale list can't
//    delete the wrong film if rows have moved);
//  - nothing is wiped: the row is copied to a "Deleted" tab, with the date, before removal.
const RECENT_LIMIT = 5;
const DELETED_TAB = "Deleted";

function deleteFilm_(data) {
  const id = Number(data.id);
  const title = String(data.title || "").trim();
  if (!id || !title) return reply_({ ok: false, error: "Which film? (missing ID or title)" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(TRACKER_TAB);
    if (!sheet) throw new Error('Worksheet "' + TRACKER_TAB + '" not found.');
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h).trim());
    const titleAt = headers.indexOf("Movie Title"), idAt = headers.indexOf("Record ID");
    if (titleAt === -1 || idAt === -1) throw new Error("Missing Movie Title or Record ID column.");

    // Sheet row numbers of the films (rows with a title), oldest first.
    const filmRows = [];
    values.forEach((row, i) => { if (i > 0 && String(row[titleAt]).trim() !== "") filmRows.push(i + 1); });
    const recentRows = filmRows.slice(-RECENT_LIMIT);

    const rowNumber = filmRows.find(r => Number(values[r - 1][idAt]) === id);
    if (!rowNumber) return reply_({ ok: false, error: "Couldn't find that film in the Sheet. Refresh the list and try again." });
    if (String(values[rowNumber - 1][titleAt]).trim() !== title) {
      return reply_({ ok: false, error: "The Sheet has changed since the list loaded. Refresh and try again." });
    }
    if (recentRows.indexOf(rowNumber) === -1) {
      return reply_({ ok: false, error: "Only the " + RECENT_LIMIT + " most recent films can be deleted from the app." });
    }

    // Copy to the Deleted tab first (created with the same headers the first time).
    let bin = book.getSheetByName(DELETED_TAB);
    if (!bin) {
      bin = book.insertSheet(DELETED_TAB);
      bin.appendRow(headers.concat(["Deleted on"]));
    }
    bin.appendRow(values[rowNumber - 1].concat([new Date()]));

    sheet.deleteRow(rowNumber);
    SpreadsheetApp.flush();
    return reply_({ ok: true, deleted: title });
  } catch (err) {
    return reply_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
