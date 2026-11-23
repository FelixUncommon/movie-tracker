// Movie tracker: lets the phone app add a film to the "Raw" tab.
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

// The phone app sends: { key, title, date: "YYYY-MM-DD", rating, rewatch }
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: "Couldn't read the request." });
  }

  // 1. Check the secret key before doing anything else.
  const key = PropertiesService.getScriptProperties().getProperty("TRACKER_KEY");
  if (!key || data.key !== key) {
    return reply_({ ok: false, error: "Wrong key." });
  }

  // 2. Check the film details make sense.
  const title = String(data.title || "").trim();
  const rating = Number(data.rating);
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.date || ""));
  if (!title) return reply_({ ok: false, error: "Title is missing." });
  if (!dateParts) return reply_({ ok: false, error: "Date is missing." });
  if (!(rating >= 0 && rating <= 10) || (rating * 2) % 1 !== 0) {
    return reply_({ ok: false, error: "Rating must be 0–10 in half points." });
  }
  const [, year, month, day] = dateParts;

  // 3. Add the row. The lock stops two saves at once from grabbing the same row.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let sheet, newRow, col;
  let movieId;
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
    sheet.getRange(newRow, col("Record ID")).setValue(recordId);

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

  // 4. Run the TMDB scraper now. If TMDB fails, the film is still saved.
  let match = "";
  try {
    populateMovieData();
    match = String(sheet.getRange(newRow, col("TMDB Match")).getValue());
  } catch (err) {
    match = "TMDB lookup failed: " + (err.message || err);
  }

  return reply_({ ok: true, row: newRow, movieId: movieId, match: match });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
