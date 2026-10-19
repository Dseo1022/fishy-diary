# 🐟 Fishy Diary

A cute, pixel-themed fishing log that runs entirely in your browser — plain HTML, CSS, and JavaScript, no build step.

## Features

- Log catches with a photo, species, length, weight, location, date/time, bait or lure, weather, and a note
- Auto-fills date, time, and GPS location from photo EXIF data (via [exifr](https://github.com/MikeKovarik/exifr))
- HEIC/HEIF photo support (converted with [heic2any](https://github.com/alexcorvi/heic2any) when the browser can't display them)
- Photo editor: crop, rotate, flip, and aspect-ratio presets (via [Cropper.js](https://github.com/fengyuanchen/cropperjs))
- Scrapbook-style gallery with species filter and sorting by date or size
- Stats: total catches, biggest fish, most-caught species, favorite bait, and personal-best badges per species
- Switch between in/lb and cm/kg
- Backup and restore your diary as a JSON file

## Running it

Open `index.html` in a browser. That's it.

To use it on your phone, host the folder anywhere static (GitHub Pages, Netlify Drop, etc.) and open the link. On iPhone, use "Add to Home Screen" so Safari keeps your data.

## Where data lives

Catches are stored in your browser's IndexedDB — nothing is uploaded anywhere. Each browser/device keeps its own diary, so use **Stats → Save backup** to keep a copy or move it to another device.
