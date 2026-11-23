# Movie tracker

**Live at https://felixuncommon.github.io/movie-tracker/** (GitHub Pages, from the `main` branch). Installed on my iPhone via Safari → Share → Add to Home Screen.

Log a film from my phone in a few taps. Each save adds a row to the "Raw" tab of the cinema Google Sheet, then runs the TMDB scraper so the details fill in straight away.

## How it fits together
- `index.html`, `style.css`, `app.js`: the phone form. `app.js` sends the film to the Apps Script.
- `config.js`: the Apps Script web app address. Not secret on its own.
- `apps-script/Tracker.gs`: backup of the script that adds the row. The live copy sits in the Sheet's Apps Script project, next to the scraper (`Code.gs`).
- The **secret key** is kept in two places only: the Sheet's Script Properties (`TRACKER_KEY`) and my phone (typed in once). It is never in this code.

## One-off setup in the Sheet
1. Open the cinema Sheet → **Extensions → Apps Script**.
2. Next to **Files**, click **+ → Script** and name it `Tracker`. Paste in everything from `apps-script/Tracker.gs`, then save.
3. Click the cog (**Project Settings**). Under **Script Properties**, click **Add script property**: name `TRACKER_KEY`, value a passphrase I make up (e.g. four random words). `TMDB_TOKEN` is already listed there; leave it.
4. **Deploy → New deployment**. Click the cog next to "Select type" → **Web app**.
   - Description: `Movie tracker`
   - Execute as: **Me**
   - Who has access: **Anyone** (the key does the protecting; "Anyone with a Google account" would block the phone app)
5. Click **Deploy** and approve the permissions if Google asks. Copy the **Web app URL**.
6. Check it: open that URL in a browser. It should say `"Movie tracker is running."`
7. Paste the URL into `config.js`.

**Changing the script later:** saving it isn't enough. Go to **Deploy → Manage deployments → pencil → Version: New version → Deploy**, or the old code keeps running. The URL stays the same.

## Changing the key
Change `TRACKER_KEY` in Script Properties, then tap **Change key** in the app and enter the new one.

## Updating the app
Commit changes, then `git push`. GitHub Pages republishes within a minute or two. The home-screen app may need closing and reopening to pick up changes.
