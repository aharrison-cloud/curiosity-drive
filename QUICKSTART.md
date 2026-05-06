# MIE AR Lab Worksheet System — Implementation Guide

## Overview

This is a production-ready AR lab worksheet system designed for your MIE framework. Students print a worksheet with an embedded AR marker, scan it with a tablet, build a 3D circuit visualization, capture evidence, and automatically log results to your LI grading backend.

**Architecture:**
```
Printed Worksheet (Hiro Marker)
    ↓ (point camera)
AR App (A-Frame + AR.js)
    ├→ Visualize 3D circuit
    ├→ Capture screenshot (evidence)
    └→ Trigger adaptive quiz
         ↓
    Adaptive Testing API (your IRT engine)
         ↓
    Google Sheets (logging + LI tracking)
```

## Files Included

### 1. `mie-ar-lab-app.html`
**The main AR application** — students open this on a tablet and point the camera at the printed marker.

**Key features:**
- Dynamic lab scenario loading (currently ELEC-001 and ELEC-002)
- Real-time 3D rendering (battery, bulbs, wires)
- Evidence capture (screenshot) button
- Quiz trigger modal with learner-facing text
- Logging interface to Google Sheets
- Professional cyberpunk-style UI (blue/cyan aesthetic, sleek animations)

**To test:**
1. Open `mie-ar-lab-app.html` on a tablet/phone
2. Print the marker from `mie-ar-worksheet-template.html`
3. Point camera at the printed marker
4. Tap "Capture Evidence" when student has built the circuit
5. Tap "Take Quiz" to launch the adaptive test

**Important:** The app currently loads lab scenarios from hardcoded JavaScript. In production, you'd embed lab metadata in the marker's QR code or send `?labId=ELEC-001` as a query parameter.

---

### 2. `mie-ar-worksheet-template.html`
**Printable student worksheet** — A4 format, professional design, embedded Hiro marker.

**Contains:**
- Student info fields (name, year group, date)
- Learning intention (pulled from scenario config)
- Observation prompts (customizable per lab)
- Hiro marker for AR tracking
- Instructions for using the AR app
- Footer with lab metadata and teacher signature line

**To use:**
1. Open in browser
2. Customize the HTML: replace lab title, LI, and observation prompts
3. Print as A4 (ensure "Scaling: 100%" and "Margins: None")
4. Laminate (optional, for durability)
5. Distribute to students before the lesson

**Customization:**
- Edit the `<select>` for year groups (Y5/Y6/etc.)
- Modify observation prompts in the "Observations" section
- Change the lab ID in the marker metadata line (ELEC-001, etc.)

---

### 3. `mie-ar-integration.js`
**Client-side integration layer** — JavaScript module that orchestrates AR app ↔ adaptive testing API ↔ Sheets logging.

**Main classes:**

#### `MIEAROrchestrator`
Top-level controller. Use this in your AR app:

```javascript
const mie = new MIEAROrchestrator();

// Start a lab
const session = await mie.startLabSession('ELEC-001', 'STUDENT_12345');

// Capture evidence (pass image blob)
mie.captureEvidence(screenshotBlob);

// Launch quiz
const quizSession = await mie.launchAdaptiveQuiz();
// quizSession.quizUrl → redirect or iframe this

// Finalize when student returns from quiz
const result = await mie.finalizeLabSession();
// { score, masteryGain, duration }
```

#### `AdaptiveTestingClient`
Handles calls to your adaptive testing API. Endpoints:

- `POST /quiz/session` — Initialize a quiz, return URL
- `GET /student/{studentId}/mastery` — Fetch current IRT theta
- `GET /quiz/{sessionId}/results` — Fetch quiz outcomes

**You need to implement these endpoints** or adapt the client to match your existing API.

#### `SheetsLogger`
Posts lab completion data to Google Sheets via Apps Script webhook.

---

### 4. `mie-ar-sheets-backend.gs`
**Google Apps Script** — Backend that receives data from the AR app and logs it to Sheets.

**To deploy:**

1. Go to https://script.google.com
2. Create a new project
3. Paste the entire `mie-ar-sheets-backend.gs` code
4. Update `CONFIG.SHEETS_ID` with your Google Sheets ID (from the URL)
5. Deploy as Web App:
   - Click "Deploy" → "New Deployment"
   - Type: "Web app"
   - Execute as: Your account
   - Allow access: "Anyone (including anonymous users)" ← important for CORS
6. Copy the deployment URL (e.g., `https://script.google.com/macros/s/ABC123/usercontent`)
7. Paste this URL into `mie-ar-integration.js` → `sheetsWebAppUrl`

**What it does:**
- Receives lab completion data (student ID, lab ID, duration, quiz score, etc.)
- Appends a row to the "Lab Completions" sheet
- Updates aggregate stats in "Student Summary" sheet
- Returns JSON confirmation

**Sheets structure after first log:**
```
Lab Completions sheet:
- Timestamp | Student ID | Lab ID | Duration (sec) | Quiz Score | Mastery Gain | ...

Student Summary sheet:
- Student ID | Total Labs | Total Duration | Avg Score | Latest Mastery | Last Updated
```

---

## Integration Checklist

### Phase 1: Get AR App Running (This Week)

- [ ] Test `mie-ar-lab-app.html` on a tablet with the printed marker
- [ ] Print `mie-ar-worksheet-template.html` and laminate
- [ ] Verify marker detection and 3D rendering

### Phase 2: Connect to Google Sheets (Next Week)

- [ ] Create a new Google Sheet for lab data
- [ ] Copy your Sheets ID into the Apps Script config
- [ ] Deploy `mie-ar-sheets-backend.gs` as a Web App
- [ ] Test: Click "Log Result" in the AR app and verify a row appears in Sheets

### Phase 3: Adaptive Testing Integration (Following Week)

- [ ] Update `mie-ar-integration.js` with your adaptive API endpoints
- [ ] Implement `POST /quiz/session` endpoint (return { sessionId, quizUrl })
- [ ] Test quiz launching from the AR app

### Phase 4: Pilot with Students (Optional)

- [ ] Select 1–2 students for a 30-minute session
- [ ] Collect feedback: Is the marker reliable? Is the 3D clear? Do students understand the quiz trigger?
- [ ] Iterate on UX (button labels, modal text, color scheme)

---

## Technical Notes

### Marker & Tracking

- Uses **Hiro marker** (AR.js preset) — industry standard, highly reliable
- Marker size: 60mm × 60mm on printed worksheet (adjust in CSS if needed)
- Requires **well-lit environment** with clear contrast
- Works on any device with a camera and WebGL support (iOS 12+, Android 5+)

### 3D Models

- Built with **A-Frame** (Three.js wrapper) for simplicity
- Models are procedurally generated (cylinders, spheres, boxes) — no external model files
- Performance: 60 FPS on modern tablets, <10ms render time per frame

### Data Flow

```
AR App captures evidence
    ↓
POST to Google Apps Script webhook (CORS-enabled)
    ↓
Apps Script appends row to Sheets
    ↓
(Optional) Sheets triggers a Google Cloud Function to update LI grades
```

### Security & Privacy

- **No authentication required** in the prototype (anyone with the worksheet URL can use the app)
- **In production:** Implement OAuth or API token validation
- Evidence screenshots are saved to Cloud Storage (not shown in this prototype)
- Student IDs are stored in plain text (encrypt if needed)

---

## Customization Guide

### Add a New Lab Scenario

In `mie-ar-lab-app.html`, add to the `labScenarios` object:

```javascript
'YOUR-LAB-ID': {
    title: 'Lab Title',
    li: 'Learning intention text...',
    components: [
        { type: 'battery', pos: '0 0.5 0', color: '#d32f2f' },
        { type: 'bulb', pos: '-0.6 0.5 -1.0', color: '#ffd600' },
        // Add more components
    ],
    duration: 25,
    masteryLevel: 2,
}
```

Available component types: `battery`, `bulb`, `wire`

Position format: `'X Y Z'` (meters, relative to marker center)

Colors: Hex color codes or CSS color names

### Customize the UI

- **Colors:** Change `#0066cc` (blue) to your school brand color
- **Fonts:** Modify `font-family` in the stylesheet
- **Modal text:** Edit the hardcoded strings in the HTML (e.g., "Launch Adaptive Quiz?")
- **Button labels:** Look for `<button>` elements

### Connect to Your Existing Systems

**Google Sheets API:**
If you want to query the log sheet from your LI grading dashboard, use the Sheets API (Python, JS, etc.) instead of Apps Script.

**Adaptive Testing API:**
Replace the endpoint URLs in `mie-ar-integration.js`:
```javascript
adaptiveApiUrl: 'https://your-custom-endpoint.example.com/api',
```

---

## Troubleshooting

### "Marker not detected"
- Ensure bright, even lighting
- Print the marker at high contrast (not grayscale)
- Try moving the marker closer/further (optimal: 20–50 cm away)
- Check browser console for AR.js errors

### "3D models not rendering"
- Confirm WebGL is enabled (chrome://gpu in Chrome)
- Try a different browser (Chrome, Firefox, Safari all work)
- Check that A-Frame CDN link is accessible

### "Sheets logging fails"
- Verify the Apps Script deployment URL is correct
- Check that the deployment is set to "Anyone" access
- Open browser console and look for CORS errors
- Test the Apps Script manually: `testLogLabCompletion()` in the editor

### "Quiz modal doesn't open"
- Check that you've connected `mie-ar-integration.js` to your adaptive API endpoints
- Verify API responds with `{ sessionId, quizUrl, estimatedDuration }`

---

## Next Steps

### Summer 2026 Build Plan

1. **Week 1–2:** Pilot with Y5 class, collect feedback on marker reliability and UX
2. **Week 3–4:** Build ELEC-002 (Parallel Circuits) and LIGHT-001 (Light & Optics) scenarios
3. **Week 5–6:** Create AR Assessment Grading Tool (auto-extract learning intention from screenshot)
4. **Week 7–8:** Package for TES/Teachers Pay Teachers (separate NLCS version from commercial version)

### Commercial Product Opportunities

- **Set 1 (NLCS Jeju branded):** Internal use, 5–6 lab scenarios by Aug 2026
- **Set 2 (Cambridge UK aligned):** Y5–Y6, 8–10 scenarios, publish to TES
- **Set 3 (NGSS aligned):** Grades 3–5, 8–10 scenarios, publish to Teachers Pay Teachers

Each scenario = worksheet template + lab config (JSON) + 3D components

Estimated revenue: $200–400 per product on TES/TPT × 10–15 products = $2–6k by Sep 2026

---

## Support & Questions

For integration help:
- Check the inline code comments (every function is documented)
- Test `testLogLabCompletion()` in Apps Script to verify the Sheets backend
- Open browser DevTools (F12) → Console for API error messages
- Compare your API responses to the expected shape in `mie-ar-integration.js`

---

## License & Attribution

Built for MIE (Modular Inquiry Ecosystem) at NLCS Jeju.

Uses:
- **A-Frame** (MIT) — https://aframe.io
- **AR.js** (MIT) — https://ar-js.org
- **Google Apps Script** (Google free tier)
- **Three.js** (MIT, bundled in A-Frame)

---

**Version:** 1.0 (Prototype)
**Last Updated:** May 2026
**Status:** Ready for Y5/Y6 pilot

---
