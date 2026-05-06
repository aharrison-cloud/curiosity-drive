/**
 * MIE AR Lab → Adaptive Testing + Sheets Integration
 * 
 * This module provides the bridge between:
 * 1. AR Lab App (evidence capture, lab metadata)
 * 2. Adaptive Testing API (trigger quiz, fetch questions)
 * 3. Google Sheets (log results for LI grading)
 * 
 * Architecture:
 * AR App → POST /quiz/session → Adaptive API (returns sessionId)
 * AR App → POST /sheets/log → Google Apps Script (appends row)
 * 
 * Deployment:
 * - Adaptive testing API: Your existing IRT-based endpoint
 * - Sheets backend: Google Apps Script Web App (doPost handler)
 * - AR app: Calls these via fetch with CORS headers
 */

// ============================================
// CONFIG
// ============================================

const MIE_CONFIG = {
    // Your adaptive testing API endpoint
    adaptiveApiUrl: 'https://your-adaptive-api.example.com/api',
    
    // Google Apps Script Web App URL (deployed as public endpoint)
    sheetsWebAppUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/usercontent',
    
    // Lab scenario definitions (maps marker ID to lab metadata)
    labScenarios: {
        'ELEC-001': {
            title: 'Simple Series Circuit',
            unit: 'Electricity',
            year: 'Y5',
            learningIntention: 'Construct and analyze a series circuit',
            duration: 25,
            masteryThreshold: 2.5, // IRT theta score target
            estimatedQuizQuestions: 8,
        },
        'ELEC-002': {
            title: 'Parallel Circuit',
            unit: 'Electricity',
            year: 'Y6',
            learningIntention: 'Design a parallel circuit and measure voltage',
            duration: 30,
            masteryThreshold: 3.0,
            estimatedQuizQuestions: 10,
        },
    },
};

// ============================================
// SESSION MANAGEMENT
// ============================================

class MIEARSession {
    constructor(labId, studentId) {
        this.labId = labId;
        this.studentId = studentId;
        this.sessionId = 'AR_' + Date.now();
        this.startTime = Date.now();
        this.scenario = MIE_CONFIG.labScenarios[labId];
        this.evidenceCaptured = false;
        this.evidenceUrl = null; // Screenshot or artifact URL
    }
    
    /**
     * Log that student captured lab evidence
     * In production, this would upload the screenshot to Cloud Storage
     */
    logEvidenceCapture(imageBlob) {
        this.evidenceCaptured = true;
        this.evidenceUrl = 'gs://mie-bucket/' + this.sessionId + '.png';
        
        console.log('Evidence captured:', {
            sessionId: this.sessionId,
            labId: this.labId,
            timestamp: new Date().toISOString(),
            size: imageBlob.size,
        });
        
        // In production:
        // uploadToCloudStorage(imageBlob, this.evidenceUrl);
    }
    
    /**
     * Get elapsed time in seconds
     */
    getElapsedSeconds() {
        return Math.round((Date.now() - this.startTime) / 1000);
    }
}

// ============================================
// ADAPTIVE TESTING API
// ============================================

class AdaptiveTestingClient {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
    }
    
    /**
     * Initiate a quiz session
     * 
     * POST /quiz/session
     * {
     *   labId: string,
     *   studentId: string,
     *   currentMastery: number (IRT theta),
     *   targetMastery: number,
     *   estimatedQuestions: number
     * }
     * 
     * Returns: { sessionId, quizUrl, estimatedDuration }
     */
    async initializeQuizSession(labId, studentId, currentMastery) {
        const payload = {
            labId,
            studentId,
            currentMastery: currentMastery || 0,
            targetMastery: MIE_CONFIG.labScenarios[labId].masteryThreshold,
            estimatedQuestions: MIE_CONFIG.labScenarios[labId].estimatedQuizQuestions,
        };
        
        try {
            const response = await fetch(`${this.apiUrl}/quiz/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('mie_api_token')}`,
                },
                body: JSON.stringify(payload),
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Quiz session created:', data);
            return data; // { sessionId, quizUrl, estimatedDuration }
        } catch (error) {
            console.error('Failed to initialize quiz session:', error);
            throw error;
        }
    }
    
    /**
     * Fetch current student mastery level (IRT theta)
     * 
     * GET /student/{studentId}/mastery
     */
    async getCurrentMastery(studentId) {
        try {
            const response = await fetch(`${this.apiUrl}/student/${studentId}/mastery`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('mie_api_token')}` },
            });
            
            const data = await response.json();
            return data.theta; // IRT theta score
        } catch (error) {
            console.warn('Could not fetch current mastery, using default:', error);
            return 0;
        }
    }
    
    /**
     * Get quiz results after completion
     * 
     * GET /quiz/{sessionId}/results
     */
    async getQuizResults(sessionId) {
        try {
            const response = await fetch(`${this.apiUrl}/quiz/${sessionId}/results`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('mie_api_token')}` },
            });
            
            const data = await response.json();
            return data; // { score, theta, masteryGained, questionsAttempted }
        } catch (error) {
            console.error('Failed to fetch quiz results:', error);
            throw error;
        }
    }
}

// ============================================
// GOOGLE SHEETS LOGGING
// ============================================

class SheetsLogger {
    constructor(webAppUrl) {
        this.webAppUrl = webAppUrl;
    }
    
    /**
     * Log lab completion to Google Sheets
     * 
     * The Apps Script backend (doPost) expects:
     * {
     *   action: 'logLabCompletion',
     *   labId: string,
     *   studentId: string,
     *   durationSeconds: number,
     *   evidenceUrl: string,
     *   quizScore: number,
     *   masteryGain: number,
     *   timestamp: ISO string
     * }
     */
    async logLabCompletion(session, quizResults) {
        const payload = {
            action: 'logLabCompletion',
            labId: session.labId,
            studentId: session.studentId,
            durationSeconds: session.getElapsedSeconds(),
            evidenceUrl: session.evidenceUrl,
            quizScore: quizResults?.score || null,
            masteryGain: quizResults?.masteryGained || null,
            timestamp: new Date().toISOString(),
        };
        
        try {
            const response = await fetch(this.webAppUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            const data = await response.json();
            console.log('Logged to Sheets:', data);
            return data;
        } catch (error) {
            console.error('Failed to log to Sheets:', error);
            throw error;
        }
    }
    
    /**
     * Optional: Fetch student's existing lab history from Sheets
     * Useful for showing progress dashboard
     */
    async getStudentLabHistory(studentId) {
        try {
            const response = await fetch(`${this.webAppUrl}?action=getHistory&studentId=${studentId}`);
            const data = await response.json();
            return data.history; // Array of past lab sessions
        } catch (error) {
            console.warn('Could not fetch history:', error);
            return [];
        }
    }
}

// ============================================
// ORCHESTRATION (AR App calls this)
// ============================================

class MIEAROrchestrator {
    constructor() {
        this.adaptiveClient = new AdaptiveTestingClient(MIE_CONFIG.adaptiveApiUrl);
        this.sheetsLogger = new SheetsLogger(MIE_CONFIG.sheetsWebAppUrl);
        this.currentSession = null;
    }
    
    /**
     * Called when student starts a lab
     */
    async startLabSession(labId, studentId) {
        this.currentSession = new MIEARSession(labId, studentId);
        console.log('Lab session started:', this.currentSession.sessionId);
        return this.currentSession;
    }
    
    /**
     * Called when student captures evidence (AR screenshot)
     */
    captureEvidence(imageBlob) {
        if (!this.currentSession) throw new Error('No active session');
        this.currentSession.logEvidenceCapture(imageBlob);
    }
    
    /**
     * Called when student clicks "Take Quiz"
     * Orchestrates: fetch current mastery → init quiz session → show quiz URL
     */
    async launchAdaptiveQuiz() {
        if (!this.currentSession) throw new Error('No active session');
        
        try {
            // Get current mastery level
            const currentMastery = await this.adaptiveClient.getCurrentMastery(
                this.currentSession.studentId
            );
            
            // Initialize quiz for this lab
            const quizSession = await this.adaptiveClient.initializeQuizSession(
                this.currentSession.labId,
                this.currentSession.studentId,
                currentMastery
            );
            
            // Store for later result retrieval
            this.currentSession.quizSessionId = quizSession.sessionId;
            
            return quizSession; // { sessionId, quizUrl, estimatedDuration }
        } catch (error) {
            console.error('Failed to launch quiz:', error);
            throw error;
        }
    }
    
    /**
     * Called when student completes quiz and returns to AR app
     * Orchestrates: fetch quiz results → log to Sheets → show summary
     */
    async finalizeLabSession() {
        if (!this.currentSession) throw new Error('No active session');
        if (!this.currentSession.quizSessionId) throw new Error('Quiz not completed');
        
        try {
            // Get quiz results from adaptive API
            const quizResults = await this.adaptiveClient.getQuizResults(
                this.currentSession.quizSessionId
            );
            
            // Log everything to Sheets
            await this.sheetsLogger.logLabCompletion(
                this.currentSession,
                quizResults
            );
            
            return {
                sessionId: this.currentSession.sessionId,
                score: quizResults.score,
                masteryGain: quizResults.masteryGained,
                duration: this.currentSession.getElapsedSeconds(),
            };
        } catch (error) {
            console.error('Failed to finalize session:', error);
            throw error;
        }
    }
}

// ============================================
// EXPORT FOR AR APP
// ============================================

// In AR app, use like:
//
// const mie = new MIEAROrchestrator();
// 
// // Start lab
// const session = await mie.startLabSession('ELEC-001', 'STUDENT_12345');
// 
// // Capture evidence
// mie.captureEvidence(screenshotBlob);
// 
// // Launch quiz
// const quizSession = await mie.launchAdaptiveQuiz();
// window.location.href = quizSession.quizUrl; // or iframe it
// 
// // After quiz completes (when user returns)
// const result = await mie.finalizeLabSession();
// console.log('Lab complete:', result);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MIEAROrchestrator, MIE_CONFIG };
}
