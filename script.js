document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const overallStatusEl = document.getElementById('overall-status');
    const overallStatusIconEl = document.getElementById('overall-status-icon');
    const browserStatusEl = document.getElementById('browser-status');
    const browserStatusIconEl = document.getElementById('browser-status-icon');
    const connectivityStatusEl = document.getElementById('connectivity-status');
    const connectivityStatusIconEl = document.getElementById('connectivity-status-icon');
    const connectTimeEl = document.getElementById('connect-time');
    const disconnectTimeEl = document.getElementById('disconnect-time');
    const lastCheckTimeEl = document.getElementById('last-check-time');
    const eventLogEl = document.getElementById('event-log');
    const reportLogEl = document.getElementById('report-log');

    const userEmailInput = document.getElementById('user-email-input');
    const targetUrlDisplayEl = document.getElementById('target-url-display'); // Renamed
    const checkIntervalInput = document.getElementById('check-interval');

    const startMonitoringBtn = document.getElementById('start-monitoring');
    const stopMonitoringBtn = document.getElementById('stop-monitoring');
    const generateReportEmailBtn = document.getElementById('generate-report-email');
    const exportLogBtn = document.getElementById('export-log-btn');
    const testSpeedBtn = document.getElementById('test-speed-btn');
    const speedTestResultEl = document.getElementById('speed-test-result');
    const alertSound = document.getElementById('alert-sound');

    // --- State & Configuration ---
    let monitoringIntervalId = null;
    let connectionStartTime = null;
    let lastDisconnectionTime = null;
    let lastSuccessfulCheckTime = null;
    let isEffectivelyOnline = false;
    let effectiveDisconnectReason = "Unknown"; // To store more specific reasons

    const LOG_PREFIX = "NM_PRO_"; // Network Monitor Pro prefix

    // Connectivity Check Targets (Primary first)
    // IMPORTANT: If you use internal URLs, ensure they have CORS enabled if this page is served from a different origin.
    const CHECK_TARGET_URLS = [
        "https://www.google.com/generate_204",      // Google's 204 endpoint is good for this
        "https://www.cloudflare.com/cdn-cgi/trace", // Cloudflare returns small text
        "https://1.1.1.1/favicon.ico",              // Cloudflare DNS
        // Add your internal /healthcheck URL here if available
        // e.g., "http://your-internal-server/healthcheck"
    ];
    let currentTargetUrlIndex = 0;
    targetUrlDisplayEl.value = CHECK_TARGET_URLS.join(', '); // Display them

    // Speed Test Configuration
    // CHOOSE A RELIABLE FILE AND GET ITS ACCURATE SIZE
    // Example: Consider hosting a ~1MB file on your own server/CDN if possible for consistency
    // Using a public file, check its usage policy and if it might change.
    const SPEED_TEST_FILE_URL = 'https://proof.ovh.net/files/1Mb.dat'; // 1MB test file (check OVH terms)
    const SPEED_TEST_FILE_SIZE_BYTES = 1000000; // 1MB = 1,000,000 Bytes (or 1024*1024 if you prefer MiB)

    // EmailJS Configuration - REPLACE WITH YOUR DETAILS
    const EMAILJS_SERVICE_ID = 'service_ytoz2q5';
    const EMAILJS_TEMPLATE_ID = 'template_6tj0qdn';
    // Public Key is initialized in HTML

    // --- Utility Functions ---
    function getCurrentTimestamp() {
        return new Date().toLocaleString();
    }

    function playAlertSound() {
        alertSound.play().catch(e => console.warn("Audio play failed:", e));
    }

    function addEventLog(message, type = 'info') {
        const p = document.createElement('p');
        p.innerHTML = `<i class="fas ${
            type === 'error' ? 'fa-exclamation-circle status-issue' :
            type === 'success' ? 'fa-check-circle status-ok' :
            type === 'warning' ? 'fa-exclamation-triangle status-checking' : // Added warning type
            'fa-info-circle status-unknown'
        }"></i> [${getCurrentTimestamp()}] ${message}`; // Added icons to log

        if (type === 'error') p.classList.add('status-issue');
        else if (type === 'success') p.classList.add('status-ok');
        else if (type === 'warning') p.classList.add('status-checking');

        eventLogEl.insertBefore(p, eventLogEl.firstChild);
        console.log(`[${getCurrentTimestamp()}] ${type.toUpperCase()}: ${message}`);
    }

    function updateStatusUI(element, iconElement, status, textOnline, textOffline, onlineIcon, offlineIcon, unknownIcon = 'fa-question-circle') {
        const currentIcon = status === null ? unknownIcon : (status ? onlineIcon : offlineIcon);
        const currentText = status === null ? "Unknown" : (status ? textOnline : textOffline);
        const currentClass = status === null ? 'status-unknown' : (status ? 'status-online' : 'status-offline');

        element.textContent = currentText;
        element.className = currentClass;
        iconElement.className = `fas ${currentIcon} ${currentClass}`;
    }

    function updateConnectivityStatusUI(statusType, message) { // statusType: 'ok', 'issue', 'checking', 'unknown'
        connectivityStatusEl.textContent = message;
        let iconClass = 'fa-question-circle status-unknown';
        let textClass = 'status-unknown';

        if (statusType === 'ok') {
            iconClass = 'fa-plug status-ok';
            textClass = 'status-ok';
        } else if (statusType === 'issue') {
            iconClass = 'fa-exclamation-triangle status-issue';
            textClass = 'status-issue';
        } else if (statusType === 'checking') {
            iconClass = 'fa-sync-alt fa-spin status-checking'; // Spinning icon
            textClass = 'status-checking';
        }
        connectivityStatusEl.className = textClass;
        connectivityStatusIconEl.className = `fas ${iconClass} ${textClass}`;
    }


    function updateOverallStatus() {
        const browserOnline = navigator.onLine;
        let effectivelyOnlineNow = browserOnline && connectivityStatusEl.classList.contains('status-ok');

        if (effectivelyOnlineNow) {
            if (!isEffectivelyOnline) { // Just came online effectively
                if (!connectionStartTime) {
                    connectionStartTime = new Date();
                    connectTimeEl.textContent = connectionStartTime.toLocaleString();
                    localStorage.setItem(LOG_PREFIX + 'connectionStartTime', connectionStartTime.toISOString());
                    addEventLog("Network connection established and verified.", "success");
                }
                disconnectTimeEl.textContent = "N/A"; // Clear last disconnect
            }
            isEffectivelyOnline = true;
            overallStatusEl.textContent = "Connected & Flowing";
            overallStatusEl.className = 'status-online';
            overallStatusIconEl.className = 'fas fa-check-circle status-online';
        } else {
            // Determine a more specific reason if transitioning to offline
            let currentReason = "Issue Detected";
            if (!browserOnline) {
                currentReason = "Browser Offline (e.g. Wi-Fi/cable disconnected)";
            } else if (connectivityStatusEl.classList.contains('status-issue')) {
                currentReason = "Target Server(s) Unreachable (Internet or Server issue)";
            } else if (connectivityStatusEl.classList.contains('status-checking')) {
                currentReason = "Connectivity Check in Progress";
            }


            if (isEffectivelyOnline) { // Was online, now isn't (or monitoring stopped while online)
                lastDisconnectionTime = new Date();
                disconnectTimeEl.textContent = lastDisconnectionTime.toLocaleString();
                effectiveDisconnectReason = currentReason; // Store the reason at time of disconnect
                addEventLog(`Network connection lost or degraded. Reason: ${effectiveDisconnectReason}`, "error");
                notifyUser("Network Issue Detected", `Reason: ${effectiveDisconnectReason} at ${lastDisconnectionTime.toLocaleString()}`);
                playAlertSound();
                // Auto-send email if configured and not a manual stop
                if (monitoringIntervalId) { // Only if monitoring was active (not manual stop)
                     generateReportAndSendEmail(effectiveDisconnectReason, false); // false = not a manual stop
                }
            }
            isEffectivelyOnline = false;
            overallStatusEl.textContent = currentReason === "Connectivity Check in Progress" ? "Checking..." : "Disconnected / Issue";
            overallStatusEl.className = currentReason === "Connectivity Check in Progress" ? 'status-checking' : 'status-offline';
            overallStatusIconEl.className = `fas ${
                currentReason === "Connectivity Check in Progress" ? 'fa-spinner fa-spin status-checking' : 'fa-times-circle status-offline'
            }`;
        }
    }


    // --- Core Monitoring Logic ---
    async function checkConnectivity() {
        if (!navigator.onLine) {
            updateConnectivityStatusUI('issue', 'Browser is Offline');
            // Overall status will be updated by handleOffline -> updateOverallStatus
            return; // No need to proceed if browser itself is offline
        }

        const targetUrl = CHECK_TARGET_URLS[currentTargetUrlIndex];
        lastCheckTimeEl.textContent = getCurrentTimestamp();
        updateConnectivityStatusUI('checking', `Pinging ${targetUrl.split('/')[2]}...`);

        try {
            // Using 'no-cors' for public endpoints without specific CORS for HEAD.
            // If you have an internal endpoint with CORS, you can use mode: 'cors' and check response.ok.
            // generate_204 returns an empty 204, so fetch will resolve.
            // cdn-cgi/trace returns small text, also good.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout for fetch

            const response = await fetch(`${targetUrl}?t=${new Date().getTime()}`, {
                method: (targetUrl.includes('generate_204') || targetUrl.includes('favicon.ico')) ? 'HEAD' : 'GET', // HEAD for favicons/204, GET for trace
                mode: 'no-cors', // For generate_204 and favicons. For 'trace' you might get an opaque response.
                                // If using an internal API with CORS, set to 'cors'
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            // For 'no-cors', response.ok and response.status are not reliable for cross-origin.
            // A resolved promise (no exception) is generally a good sign for 'no-cors' HEAD.
            addEventLog(`Connectivity check to ${targetUrl.split('/[2]')} successful.`, 'success');
            updateConnectivityStatusUI('ok', `Target Reachable: ${targetUrl.split('/')[2]}`);
            lastSuccessfulCheckTime = new Date();
            currentTargetUrlIndex = 0; // Reset to primary on success
        } catch (error) {
            clearTimeout(timeoutId); // Clear timeout if error occurred before it fired
            addEventLog(`Check to ${targetUrl.split('/')[2]} FAILED. ${error.name === 'AbortError' ? 'Timeout' : error.message}`, 'error');
            currentTargetUrlIndex = (currentTargetUrlIndex + 1) % CHECK_TARGET_URLS.length;

            if (currentTargetUrlIndex === 0) { // Cycled through all, all failed
                updateConnectivityStatusUI('issue', 'All Targets Unreachable');
                // This is a more critical failure state, updateOverallStatus will handle notification
            } else {
                addEventLog(`Trying next target: ${CHECK_TARGET_URLS[currentTargetUrlIndex].split('/')[2]}`, 'warning');
                updateConnectivityStatusUI('issue', `Target ${targetUrl.split('/')[2]} Failed. Trying next.`);
                // Optionally, trigger an immediate check of the next URL rather than waiting for the interval
                // setTimeout(checkConnectivity, 1000); // Be cautious with recursive calls
            }
        }
        updateOverallStatus(); // Crucial to update based on check result
    }

    // --- Event Handlers & Controls ---
    function handleOnline() {
        addEventLog("Browser reports network ONLINE.", "success");
        updateStatusUI(browserStatusEl, browserStatusIconEl, true, "Online", "Offline", "fa-wifi", "fa-ban");
        disconnectTimeEl.textContent = "N/A"; // Clear last disconnect time

        if (monitoringIntervalId) { // If monitoring was active, force a check
             checkConnectivity(); // This will then call updateOverallStatus
        } else {
            updateOverallStatus(); // Update overall status if monitoring isn't running
        }
    }

    function handleOffline() {
        addEventLog("Browser reports network OFFLINE.", "error");
        updateStatusUI(browserStatusEl, browserStatusIconEl, false, "Online", "Offline", "fa-wifi", "fa-ban");
        updateConnectivityStatusUI('issue', 'Browser is Offline'); // Explicitly set this
        // updateOverallStatus will handle recording disconnect time, reason, and notifying
        updateOverallStatus();
    }

    function startMonitoring() {
        if (monitoringIntervalId) return;

        saveConfiguration(); // Save current settings like interval and email
        addEventLog("Monitoring started.", "info");
        startMonitoringBtn.disabled = true;
        stopMonitoringBtn.disabled = false;
        userEmailInput.disabled = true;
        checkIntervalInput.disabled = true;
        generateReportEmailBtn.disabled = false; // Enable manual report button
        exportLogBtn.disabled = false; // Enable export log button

        connectionStartTime = new Date(); // Reset/set connection start time
        localStorage.setItem(LOG_PREFIX + 'connectionStartTime', connectionStartTime.toISOString());
        connectTimeEl.textContent = connectionStartTime.toLocaleString();
        disconnectTimeEl.textContent = "N/A";
        lastDisconnectionTime = null; // Reset last disconnect time
        isEffectivelyOnline = false; // Reset effective online state, will be set by first check

        // Initial status updates
        handleOnlineStatusChange(); // Sets browser status and potentially calls updateOverallStatus
        checkConnectivity(); // Perform initial check, which also calls updateOverallStatus

        const intervalSeconds = parseInt(checkIntervalInput.value, 10);
        monitoringIntervalId = setInterval(checkConnectivity, intervalSeconds * 1000);
    }

    function stopMonitoring(reason = "Manual Stop by User", autoSend = true) {
        if (!monitoringIntervalId && reason === "Manual Stop by User") { // Prevent multiple stops if already stopped
            addEventLog("Monitoring is already stopped.", "info");
            return;
        }

        const wasMonitoring = !!monitoringIntervalId;
        clearInterval(monitoringIntervalId);
        monitoringIntervalId = null;
        effectiveDisconnectReason = reason; // Set reason for report

        addEventLog(`Monitoring stopped. Reason: ${reason}`, "info");
        startMonitoringBtn.disabled = false;
        stopMonitoringBtn.disabled = true;
        userEmailInput.disabled = false;
        checkIntervalInput.disabled = false;
        // generateReportEmailBtn remains enabled
        // exportLogBtn remains enabled

        updateConnectivityStatusUI('unknown', 'Not Running');

        if (isEffectivelyOnline || wasMonitoring) { // If it was online when stopped, or if we were monitoring
            if(!lastDisconnectionTime) lastDisconnectionTime = new Date(); // Ensure disconnect time is set
            disconnectTimeEl.textContent = lastDisconnectionTime.toLocaleString();
        }
        isEffectivelyOnline = false; // Ensure overall status reflects stopped state
        updateOverallStatus(); // Update UI to reflect "stopped" or "disconnected"

        if (autoSend) { // Only auto-send if requested (e.g., not if browser tab closes)
            generateReportAndSendEmail(reason, true); // true = manual stop for report context
        } else {
            generateReport(reason, true); // Just generate the text report
        }
    }

    function handleOnlineStatusChange() {
        const online = navigator.onLine;
        updateStatusUI(browserStatusEl, browserStatusIconEl, online, "Online", "Offline", "fa-wifi", "fa-ban");
        if (online) {
            handleOnline();
        } else {
            handleOffline();
        }
    }

    // --- Notifications, Reporting & Email ---
    function requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    addEventLog(`Desktop notification permission: ${permission}.`, permission === 'granted' ? 'success' : 'info');
                });
            }
        }
    }

    function notifyUser(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: body, icon: 'network_icon.png' }); // Create a network_icon.png
        }
        addEventLog(`DESKTOP NOTIFICATION: ${title} - ${body}`, 'info'); // Log all attempts
    }

    function generateReportText(reasonForReport, isManualStopOrEndOfSession) {
        let report = `Network Monitoring Report\n`;
        report += `---------------------------\n`;
        report += `Session Start: ${connectionStartTime ? connectionStartTime.toLocaleString() : 'N/A (or before page load)'}\n`;
        const endTime = (isManualStopOrEndOfSession && lastDisconnectionTime) ? lastDisconnectionTime : new Date();
        report += `Session End/Report Time: ${endTime.toLocaleString()}\n`;
        report += `Reason for Report: ${reasonForReport}\n\n`;

        report += `Target URLs Checked (Primary First):\n${CHECK_TARGET_URLS.map(u => ` - ${u}`).join('\n')}\n\n`;
        report += `Check Interval: ${checkIntervalInput.value} seconds\n`;
        report += `Browser Status at End: ${navigator.onLine ? 'Online' : 'Offline'}\n`;
        report += `Last Successful Connectivity Check: ${lastSuccessfulCheckTime ? lastSuccessfulCheckTime.toLocaleString() : 'N/A'}\n\n`;

        report += `Events During Session (Latest First):\n`;
        const logEntries = Array.from(eventLogEl.children).map(p => p.textContent); // Already latest first
        report += logEntries.join('\n');
        report += `\n---------------------------\nReport Generated: ${getCurrentTimestamp()}`;

        reportLogEl.value = report;
        return report;
    }

    function generateReportAndSendEmail(reasonForReport, isManualStopOrEndOfSession = false) {
        const reportContent = generateReportText(reasonForReport, isManualStopOrEndOfSession);
        const userEmail = userEmailInput.value;

        if (!userEmail) {
            addEventLog("User email not provided. Automatic email skipped. Manual report generated.", "warning");
            generateReportEmailBtn.disabled = false; // Ensure manual button is enabled
            return;
        }
        if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || EMAILJS_SERVICE_ID === 'YOUR_EMAILJS_SERVICE_ID') {
            addEventLog("EmailJS not configured. Automatic email skipped. Manual report generated.", "error");
            generateReportEmailBtn.disabled = false;
            return;
        }

        const templateParams = {
            // Ensure these param names match your EmailJS template variables
            to_email: userEmail, // Common practice for recipient
            from_name: "Network Monitor Pro",
            session_start_time: connectionStartTime ? connectionStartTime.toLocaleString() : 'N/A',
            session_end_time: (isManualStopOrEndOfSession && lastDisconnectionTime) ? lastDisconnectionTime.toLocaleString() : getCurrentTimestamp(),
            report_reason: reasonForReport,
            full_report_content: reportContent,
            // Add any other params your template uses
        };

        addEventLog(`Attempting to send automatic email to ${userEmail} for: ${reasonForReport}`, "info");

        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
            .then((response) => {
                addEventLog(`SUCCESS! Automated report email sent to ${userEmail}. Status: ${response.status}`, 'success');
                notifyUser("Report Emailed", `The network report has been sent to ${userEmail}.`);
            }, (err) => {
                addEventLog(`FAILED to send automated email to ${userEmail}. Error: ${JSON.stringify(err)}`, 'error');
                console.error('EmailJS send error:', err);
                notifyUser("Email Failed", "Could not automatically send report. Please use manual button.");
                generateReportEmailBtn.disabled = false; // Fallback to manual
            });
    }

    function manuallyGenerateEmail() { // For the manual button
        const reason = "Manual Report Generation by User";
        const reportContent = generateReportText(reason, true); // true for end of session context
        const userEmail = userEmailInput.value;
        const subject = `Network Monitoring Report - ${getCurrentTimestamp()}`;
        
        if (!reportContent) {
            alert("No report data to send.");
            return;
        }
        // Fallback to mailto: if EmailJS is not configured or user prefers it
        const mailtoLink = `mailto:${userEmail ? userEmail : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportContent)}`;
        window.open(mailtoLink, '_blank');
        addEventLog("Manual email report link generated for user to send.", "info");
    }

    // --- Speed Test ---
    async function testDownloadSpeed() {
        addEventLog("Starting download speed test...", "info");
        speedTestResultEl.textContent = "Testing...";
        speedTestResultEl.className = 'status-checking';
        testSpeedBtn.disabled = true;

        const startTime = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for speed test file

            const response = await fetch(SPEED_TEST_FILE_URL + '?t=' + new Date().getTime(), {
                cache: 'no-store',
                signal: controller.signal
            }); // Cache bust
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} while fetching speed test file.`);
            }
            const blob = await response.blob(); // Consume the response body
            const endTime = performance.now();
            const durationSeconds = (endTime - startTime) / 1000;

            if (durationSeconds === 0) throw new Error("Test duration too short, division by zero.");

            const fileSizeMB = SPEED_TEST_FILE_SIZE_BYTES / (1024 * 1024); // Size in MegaBytes
            const speedMBps = fileSizeMB / durationSeconds; // MB/s

            let friendlySpeed;
            if (speedMBps >= 0.1) { // Show MBps if decent speed
                friendlySpeed = `${speedMBps.toFixed(2)} MB/s`;
            } else {
                const speedKBps = (SPEED_TEST_FILE_SIZE_BYTES / 1024) / durationSeconds; // KB/s
                friendlySpeed = `${speedKBps.toFixed(2)} KB/s`;
            }

            speedTestResultEl.textContent = friendlySpeed;
            speedTestResultEl.className = 'status-ok';
            addEventLog(`Speed test: ${friendlySpeed} (File: ${SPEED_TEST_FILE_URL.split('/').pop()}, Size: ${(SPEED_TEST_FILE_SIZE_BYTES / (1024*1024)).toFixed(2)}MB, Duration: ${durationSeconds.toFixed(2)}s)`, "success");

        } catch (error) {
            speedTestResultEl.textContent = "Error";
            speedTestResultEl.className = 'status-issue';
            addEventLog(`Speed test FAILED. Error: ${error.name === 'AbortError' ? 'Timeout' : error.message}`, "error");
            console.error("Speed test error:", error);
        } finally {
            testSpeedBtn.disabled = false;
        }
    }

    // --- Config Persistence ---
    function loadConfiguration() {
        const savedInterval = localStorage.getItem(LOG_PREFIX + 'checkInterval');
        if (savedInterval) checkIntervalInput.value = savedInterval;

        const savedUserEmail = localStorage.getItem(LOG_PREFIX + 'userEmail');
        if (savedUserEmail) userEmailInput.value = savedUserEmail;

        // Load connection start time if page was reloaded during monitoring
        const storedStartTime = localStorage.getItem(LOG_PREFIX + 'connectionStartTime');
        if (storedStartTime) {
            // Check if this is a fresh load or a reload of an active session
            // This logic might need refinement based on how you want to handle reloads.
            // For now, we'll only use it if monitoring wasn't explicitly stopped.
            // if (localStorage.getItem(LOG_PREFIX + 'monitoringActive') === 'true') {
            //    connectionStartTime = new Date(storedStartTime);
            //    connectTimeEl.textContent = connectionStartTime.toLocaleString();
            //    addEventLog("Resumed session, connection start time loaded.", "info");
            // }
        }
        addEventLog("Configuration loaded.", "info");
    }

    function saveConfiguration() {
        localStorage.setItem(LOG_PREFIX + 'checkInterval', checkIntervalInput.value);
        localStorage.setItem(LOG_PREFIX + 'userEmail', userEmailInput.value);
        // localStorage.setItem(LOG_PREFIX + 'monitoringActive', !!monitoringIntervalId);
        addEventLog("Configuration saved.", "info");
    }

    // --- Log Export ---
    function exportEventLog() {
        const logEntries = Array.from(eventLogEl.children)
            .map(p => p.textContent) // Already latest first due to insertBefore
            .reverse(); // Reverse to get chronological for export
        const logContent = `Network Monitor Pro - Event Log\nReport Time: ${getCurrentTimestamp()}\n-------------------------------------\n${logEntries.join('\n')}`;

        if (logEntries.length === 0) {
            alert("Log is empty.");
            return;
        }

        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
        a.download = `network_monitor_log_${dateStr}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addEventLog("Event log exported.", "info");
    }

    // --- Initial Setup ---
    loadConfiguration();
    requestNotificationPermission();
    handleOnlineStatusChange(); // Set initial browser & overall status

    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
    startMonitoringBtn.addEventListener('click', startMonitoring);
    stopMonitoringBtn.addEventListener('click', () => stopMonitoring("Manual Stop by User", true)); // true to autoSend email
    generateReportEmailBtn.addEventListener('click', manuallyGenerateEmail);
    exportLogBtn.addEventListener('click', exportEventLog);
    testSpeedBtn.addEventListener('click', testDownloadSpeed);

    // Save config on input change if needed (optional, good for persistence if user changes then refreshes)
    checkIntervalInput.addEventListener('change', saveConfiguration);
    userEmailInput.addEventListener('change', saveConfiguration);
    
    // Handle page unload - attempt to stop monitoring and generate a final report (email might not send reliably)
    window.addEventListener('beforeunload', (event) => {
        if (monitoringIntervalId) {
            addEventLog("Page unloading during active monitoring.", "warning");
            // Try to quickly generate a report. EmailJS might not complete.
            stopMonitoring("Page Unload / Browser Closed", false); // false = don't try to autoSend email, it likely won't work
            // Standard browser behavior for beforeunload if you want to prompt user:
            // event.preventDefault();
            // event.returnValue = ''; // For older browsers
        }
        // Clear stored start time if monitoring was not "gracefully" stopped, to avoid incorrect resume
        // Or, implement a more robust session resume logic
        // localStorage.removeItem(LOG_PREFIX + 'connectionStartTime');
    });

    addEventLog("Network Monitor Pro Initialized. Configure email and click 'Start Monitoring'.", "info");
});