# The Artist's Way · 12-Week Companion Tracker (PWA)

A minimalist, paper-inspired Progressive Web App designed as an accountability companion for Julia Cameron's *The Artist's Way*.

Built with vanilla HTML, CSS, and JavaScript. Designed mobile-first specifically for iOS Home Screen installation with offline support via Service Worker.

---

## Features

- **12-Week Chapter Layout**: Includes all 12 official chapter themes from the book (from *Week 1: Recovering a Sense of Safety* to *Week 12: Recovering a Sense of Faith*).
- **Day & Night Desk Modes (Dark Mode)**: One-tap toggle between warm creamy paper mode and a soothing, dimly-lit "Night Desk" dark theme (charcoal slate, ivory text, and muted embers). Automatically detects iOS system preferences and remembers your choice with zero white-flash.
- **Morning Pages Daily Tracker**: 7 tactile toggle pills (`D1`–`D7`) per week with haptic feedback and instant status updates.
- **Weekly Artist Date Tracker**: Dedicated toggle switch plus an expandable lined reflection note field for each week's outing.
- **Smart Accordion UX**: Automatically detects and expands your currently active week on launch, with quick controls to "Expand Active" or "Expand / Collapse All".
- **Overall Course Progress**: Real-time counter showing Morning Pages (`/ 84`), Artist Dates (`/ 12`), and a calming green progress bar.
- **Daily Inspiration**: Curated Julia Cameron quotes that rotate with a gentle tap.
- **100% Offline & Local Storage**: Auto-saves every tap to `localStorage`. No accounts, no database, zero tracking.
- **Custom Reset Confirmation**: In-app modal with zero native browser dialogs (`alert`/`confirm`), complete with safety warnings.
- **Backup & Restore**: Export your progress as a `.json` backup file or restore it anytime.
- **iOS Safe-Area Aware**: Built with `viewport-fit=cover`, `-webkit-tap-highlight-color: transparent`, and notch/home-bar padding.

---

## File Structure

```text
artists-way-tracker/
├── index.html            # Main application (HTML, CSS, and JS all self-contained)
├── manifest.json         # PWA Web App Manifest
├── sw.js                 # Offline Service Worker
├── icon.svg              # Scalable vector icon
├── icon-192.png          # PWA Android/Web icon (192x192)
├── icon-512.png          # PWA Android/Web icon (512x512)
├── apple-touch-icon.png  # High-res iOS Home Screen icon (180x180)
├── netlify.toml          # Netlify cache headers for instantaneous PWA updates
└── README.md             # Documentation & deployment guide
```

---

## How to Test Locally

You can test the app on your local machine before pushing:

### Option A: Using Python (built-in on macOS)
```bash
cd "artists-way-tracker"
python3 -m http.server 8080
```
Open your browser to `http://localhost:8080`.

### Option B: Using Node.js
```bash
cd "artists-way-tracker"
npx serve .
```

---

## Deploying to Netlify via GitHub

Follow these steps to host the app for free on Netlify:

### Step 1: Create a GitHub Repository
1. Go to [GitHub.com](https://github.com) and click **New Repository**.
2. Name it `artists-way-tracker` (or any name you like) and choose **Public** or **Private**.
3. In your terminal, navigate into the project folder and push the code:

```bash
cd "artists-way-tracker"
git init
git add .
git commit -m "Initial commit: The Artist's Way Companion PWA"
git branch -M main
git remote add origin https://github.com/<YOUR-GITHUB-USERNAME>/artists-way-tracker.git
git push -u origin main
```

### Step 2: Connect to Netlify
1. Go to [Netlify.com](https://www.netlify.com) and log in.
2. Click **Add new site** → **Import an existing project**.
3. Select **GitHub** and authorize Netlify.
4. Pick your `artists-way-tracker` repository.
5. In the deploy settings:
   - **Branch to deploy**: `main`
   - **Build command**: *(leave empty)*
   - **Publish directory**: *(leave empty or `.`, since `index.html` is at the root)*
6. Click **Deploy Site**.
7. Once deployed, Netlify provides a live HTTPS URL (e.g. `https://peaceful-artist-12345.netlify.app`). You can also change the site name in **Site configuration → Change site name**.

---

## Adding to Your iOS Home Screen

1. Open your live Netlify URL in **Safari** on your iPhone.
2. Tap the **Share** button (the square with an arrow pointing upward at the bottom of Safari).
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name (*The Artist's Way*) and tap **Add** in the top-right corner.
5. Tap the new app icon on your Home Screen. It will launch in **standalone mode** (no browser address bar, no navigation controls) like a native iOS application.
