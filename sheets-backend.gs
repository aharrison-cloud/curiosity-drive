/**
 * MIE AR Lab Logging Backend (Google Apps Script)
 * 
 * Deploy this as a standalone Web App:
 * 1. Create a new Apps Script project at https://script.google.com
 * 2. Paste this code into the editor
 * 3. Deploy as new deployment → Web app
 * 4. Execute as: Your account
 * 5. Allow access to: Anyone (or limit to NLCS domain)
 * 6. Copy the deployment URL and paste into AR app config
 * 
 * This handles POST requests from the AR app and logs data to Google Sheets
 */

// ============================================
// CONFIG
// ============================================

const CONFIG = {
  // Google Sheets ID (get from URL: docs.google.com/spreadsheets/d/SHEETS_ID)
  SHEETS_ID: 'YOUR_GOOGLE_SHEETS_ID_HERE',
  
  // Sheet names (will create if don't exist)
  LAB_LOG_SHEET: 'Lab Completions',
  STUDENT_SUMMARY_SHEET: 'Student Summary',
  
  // Timezone
  TIMEZONE: 'Asia/Seoul',
};

// ============================================
// MAIN HANDLERS
// ============================================

/**
 * Handle incoming POST requests from AR app
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    
    // Route by action
    switch (payload.action) {
      case 'logLabCompletion':
        return logLabCompletion(payload);
      case 'getHistory':
        return getStudentHistory(payload.studentId);
      default:
        return errorResponse('Unknown action: ' + payload.action);
    }
  } catch (error) {
    Logger.log('Error in doPost:', error);
    return errorResponse(error.message);
  }
}

/**
 * Handle incoming GET requests (for history queries)
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const studentId = e.parameter.studentId;
    
    switch (action) {
      case 'getHistory':
        return getStudentHistory(studentId);
      default:
        return errorResponse('Unknown action: ' + action);
    }
  } catch (error) {
    Logger.log('Error in doGet:', error);
    return errorResponse(error.message);
  }
}

// ============================================
// LOG LAB COMPLETION
// ============================================

/**
 * Append a lab completion record to the Lab Completions sheet
 * Calculates derived metrics and updates student summary
 */
function logLabCompletion(payload) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS_ID);
  
  // Ensure sheets exist
  ensureSheet(ss, CONFIG.LAB_LOG_SHEET);
  ensureSheet(ss, CONFIG.STUDENT_SUMMARY_SHEET);
  
  const logSheet = ss.getSheetByName(CONFIG.LAB_LOG_SHEET);
  const summarySheet = ss.getSheetByName(CONFIG.STUDENT_SUMMARY_SHEET);
  
  // ============================================
  // Prepare row for Lab Log
  // ============================================
  
  const timestamp = new Date(payload.timestamp);
  const durationMinutes = Math.round(payload.durationSeconds / 60);
  
  const row = [
    timestamp,                    // A: Timestamp
    payload.studentId,            // B: Student ID
    payload.labId,                // C: Lab ID
    payload.durationSeconds,      // D: Duration (seconds)
    durationMinutes,              // E: Duration (minutes)
    payload.evidenceUrl || '',    // F: Evidence URL
    payload.quizScore || '',      // G: Quiz Score
    payload.masteryGain || '',    // H: Mastery Gain (IRT theta)
    new Date().toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }), // I: Server timestamp
  ];
  
  // Append row to log sheet
  logSheet.appendRow(row);
  
  // Add header row if this is the first entry
  if (logSheet.getLastRow() === 1) {
    const headers = [
      'Timestamp',
      'Student ID',
      'Lab ID',
      'Duration (sec)',
      'Duration (min)',
      'Evidence URL',
      'Quiz Score',
      'Mastery Gain',
      'Server Time',
    ];
    logSheet.insertRowBefore(1);
    logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  // ============================================
  // Update Student Summary
  // ============================================
  
  updateStudentSummary(summarySheet, payload.studentId);
  
  return successResponse({
    message: 'Lab completion logged',
    sessionId: payload.sessionId,
    rowNumber: logSheet.getLastRow(),
    timestamp: timestamp.toISOString(),
  });
}

/**
 * Update the student summary sheet with aggregated stats
 */
function updateStudentSummary(summarySheet, studentId) {
  const logSheet = SpreadsheetApp.openById(CONFIG.SHEETS_ID)
    .getSheetByName(CONFIG.LAB_LOG_SHEET);
  
  // Find or create student row in summary
  let summaryRow = null;
  const summaryData = summarySheet.getDataRange().getValues();
  
  for (let i = 1; i < summaryData.length; i++) {
    if (summaryData[i][0] === studentId) {
      summaryRow = i + 1;
      break;
    }
  }
  
  // Get student's lab records from log sheet
  const logData = logSheet.getDataRange().getValues();
  const studentLabs = logData.filter(row => row[1] === studentId);
  
  // Calculate stats
  const totalLabs = studentLabs.length;
  const totalDuration = studentLabs.reduce((sum, row) => sum + (row[3] || 0), 0);
  const avgScore = studentLabs.length > 0
    ? studentLabs.reduce((sum, row) => sum + (row[6] || 0), 0) / studentLabs.length
    : '';
  
  const latestMastery = studentLabs.length > 0 ? studentLabs[studentLabs.length - 1][7] : '';
  
  // Build summary row
  const summaryRowData = [
    studentId,
    totalLabs,
    totalDuration,
    totalDuration > 0 ? Math.round(totalDuration / totalLabs) : '',
    avgScore ? avgScore.toFixed(2) : '',
    latestMastery || '',
    new Date().toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }),
  ];
  
  if (summaryRow) {
    // Update existing row
    summarySheet.getRange(summaryRow, 1, 1, summaryRowData.length).setValues([summaryRowData]);
  } else {
    // Create new row
    if (summarySheet.getLastRow() === 0) {
      const headers = [
        'Student ID',
        'Total Labs',
        'Total Duration (sec)',
        'Avg Duration (sec)',
        'Avg Quiz Score',
        'Latest Mastery',
        'Last Updated',
      ];
      summarySheet.appendRow(headers);
    }
    summarySheet.appendRow(summaryRowData);
  }
}

// ============================================
// GET STUDENT HISTORY
// ============================================

/**
 * Return a student's lab history as JSON
 * Used for progress dashboards
 */
function getStudentHistory(studentId) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS_ID);
  const logSheet = ss.getSheetByName(CONFIG.LAB_LOG_SHEET);
  
  if (!logSheet) {
    return successResponse({ history: [] });
  }
  
  const data = logSheet.getDataRange().getValues();
  const history = [];
  
  // Skip header row and filter by student
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === studentId) {
      history.push({
        timestamp: data[i][0],
        labId: data[i][2],
        durationMinutes: data[i][4],
        quizScore: data[i][6],
        masteryGain: data[i][7],
      });
    }
  }
  
  return successResponse({
    studentId: studentId,
    history: history,
  });
}

// ============================================
// UTILITIES
// ============================================

/**
 * Ensure a sheet exists; create if needed
 */
function ensureSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * Format success response
 */
function successResponse(data) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    ...data,
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Format error response
 */
function errorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    error: message,
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// OPTIONAL: Data visualization functions
// ============================================

/**
 * Generate a summary dashboard sheet
 * Run this once to set up monitoring
 */
function setupDashboard() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS_ID);
  const dashboardSheet = ensureSheet(ss, 'Dashboard');
  
  dashboardSheet.clearContents();
  
  dashboardSheet.appendRow(['MIE AR Lab Monitoring Dashboard']);
  dashboardSheet.appendRow(['']);
  dashboardSheet.appendRow(['Key Metrics']);
  dashboardSheet.appendRow(['Total Students', '=COUNTA(\'Student Summary\'!A2:A)']);
  dashboardSheet.appendRow(['Total Labs Completed', '=SUM(\'Student Summary\'!B2:B)']);
  dashboardSheet.appendRow(['Avg Quiz Score', '=AVERAGE(\'Student Summary\'!E2:E)']);
  
  // Format headers
  dashboardSheet.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  dashboardSheet.getRange(3, 1).setFontSize(12).setFontWeight('bold');
  
  SpreadsheetApp.getUi().alert('Dashboard created! Refresh to see live data.');
}

// ============================================
// TESTING (run in editor)
// ============================================

/**
 * Test logging a sample lab completion
 * Deploy the Web App first, then comment this out
 */
function testLogLabCompletion() {
  const testPayload = {
    action: 'logLabCompletion',
    sessionId: 'AR_TEST_12345',
    labId: 'ELEC-001',
    studentId: 'STUDENT_TEST_001',
    durationSeconds: 1520,
    evidenceUrl: 'gs://mie-bucket/test.png',
    quizScore: 8.5,
    masteryGain: 0.3,
    timestamp: new Date().toISOString(),
  };
  
  const response = logLabCompletion(testPayload);
  Logger.log(response);
}
