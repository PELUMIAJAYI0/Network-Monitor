document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const overallStatusEl = document.getElementById('overall-status');
    const browserStatusEl = document.getElementById('browser-status');
    const connectivityStatusEl = document.getElementById('connectivity-status');
    const connectTimeEl = document.getElementById('connect-time');
    const disconnectTimeEl = document.getElementById('disconnect-time');
    const lastCheckTimeEl = document.getElementById('last-check-time');
    const eventLogEl = document.getElementById('event-log');
    const reportLogEl = document.getElementById('report-log');
    const targetUrlInput = document.getElementById('target-url');
    const checkIntervalInput = document.getElementById('check-interval');
    const startMonitoringBtn = document.getElementById('start-monitoring');
    const stopMonitoringBtn = document.getElementById('stop-monitoring');
    const generateReportEmailBtn = document.getElementById('generate-report-email');

    // State
    let monitoringIntervalId = null;
    let connectionStartTime = null;
    let lastDisconnectionTime = null;
    let lastSuccessfulCheckTime = null;
    let isEffectivelyOnline = false; // Tracks if both browser and connectivity check are OK

    const LOG_PREFIX = "NM_"; // Network Monitor prefix for localStorage

    // --- Utility Functions ---
    function getCurrentTimestamp() {
        return new Date().toLocaleString();
    }

   function addEventLog(message, type = 'info') {
    const p = document.createElement('p');
    p.textContent = `[${getCurrentTimestamp()}] ${message}`;
    if (type === 'error') {
        p.classList.add('status-issue');
    } else if (type === 'success') {
        p.classList.add('status-ok');
    }
    // No class added for 'info' or other types, which is fine.
    eventLogEl.insertBefore(p, eventLogEl.firstChild);
    console.log(`[${getCurrentTimestamp()}] ${message}`);
}

    function updateStatusUI(status, element, textOnline = "Online", textOffline = "Offline") {
        element.textContent = status ? textOnline : textOffline;
        element.className = status ? 'status-online' : 'status-offline';
    }
    
    function updateConnectivityStatusUI(status, message) {
        connectivityStatusEl.textContent = message;
        if (status === 'checking') connectivityStatusEl.className = 'status-checking';
        else if (status === 'ok') connectivityStatusEl.className = 'status-ok';
        else if (status === 'issue') connectivityStatusEl.className = 'status-issue';
        else connectivityStatusEl.className = 'status-unknown';
    }

    function updateOverallStatus() {
        const browserOnline = navigator.onLine;
        // isEffectivelyOnline is true only if browser is online AND last connectivity check was successful
        if (browserOnline && connectivityStatusEl.classList.contains('status-ok')) {
            if (!isEffectivelyOnline) { // Just came online effectively
                if (!connectionStartTime) {
                    connectionStartTime = new Date();
                    connectTimeEl.textContent = connectionStartTime.toLocaleString();
                    localStorage.setItem(LOG_PREFIX + 'connectionStartTime', connectionStartTime.toISOString());
                    addEventLog("Network connection established and verified.", "success");
                }
            }
            isEffectivelyOnline = true;
            overallStatusEl.textContent = "Connected & Flowing";
            overallStatusEl.className = 'status-online';
        } else if (browserOnline && connectivityStatusEl.classList.contains('status-checking')) {
            isEffectivelyOnline = false; // Potentially, but not confirmed
            overallStatusEl.textContent = "Checking...";
            overallStatusEl.className = 'status-checking';
        } else {
            if (isEffectivelyOnline) { // Was online, now isn't
                lastDisconnectionTime = new Date();
                disconnectTimeEl.textContent = lastDisconnectionTime.toLocaleString();
                addEventLog("Network connection lost or degraded.", "error");
                notifyUser("Network Issue Detected", `Connection lost or target unreachable at ${lastDisconnectionTime.toLocaleString()}`);
                generateReport("Disconnection"); // Generate report on effective disconnection
            }
            isEffectivelyOnline = false;
            overallStatusEl.textContent = "Disconnected / Issue";
            overallStatusEl.className = 'status-offline';
        }
    }

    // --- Core Monitoring Logic ---
    async function checkConnectivity() {
        if (!navigator.onLine) {
            updateConnectivityStatusUI('issue', 'Browser is Offline');
            updateOverallStatus();
            return;
        }

        const targetUrl = targetUrlInput.value;
        lastCheckTimeEl.textContent = getCurrentTimestamp();
        updateConnectivityStatusUI('checking', `Pinging ${targetUrl}...`);
        
        try {
            // Adding a cache-busting query param to ensure fresh check
            const response = await fetch(`${targetUrl}?t=${new Date().getTime()}`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
            // For 'no-cors', we can't read response.status directly for cross-origin.
            // A successful fetch (even opaque) means network path is likely open.
            // If you control the target server, configure CORS for a more reliable status check.
            addEventLog(`Connectivity check to ${targetUrl} successful.`, 'success');
            updateConnectivityStatusUI('ok', 'Target Reachable');
            lastSuccessfulCheckTime = new Date();
        } catch (error) {
            addEventLog(`Connectivity check to ${targetUrl} FAILED. Error: ${error.message}`, 'error');
            updateConnectivityStatusUI('issue', 'Target Unreachable');
            // Consider if this specific failure should trigger a notification
            // notifyUser("Connectivity Issue", `Failed to reach ${targetUrl}.`); 
        }
        updateOverallStatus();
    }

    // --- Event Handlers & Controls ---
    function handleOnline() {
        addEventLog("Browser reports network ONLINE.", "success");
        updateStatusUI(true, browserStatusEl);
        // Don't reset connectionStartTime here, wait for checkConnectivity to confirm
        disconnectTimeEl.textContent = "N/A"; // Clear last disconnect time
        if (monitoringIntervalId) { // If monitoring was active, force a check
            checkConnectivity();
        }
        updateOverallStatus();
    }

    function handleOffline() {
        addEventLog("Browser reports network OFFLINE.", "error");
        updateStatusUI(false, browserStatusEl);
        updateConnectivityStatusUI('issue', 'Browser is Offline'); // Explicitly set this
        // isEffectivelyOnline will be set to false by updateOverallStatus
        updateOverallStatus(); // This will handle recording disconnect time and notifying
    }
    
    function startMonitoring() {
        if (monitoringIntervalId) return; // Already running

        addEventLog("Monitoring started.");
        startMonitoringBtn.disabled = true;
        stopMonitoringBtn.disabled = false;
        targetUrlInput.disabled = true;
        checkIntervalInput.disabled = true;
        generateReportEmailBtn.disabled = false;

        // Initial check
        handleOnlineStatusChange(); // Set initial browser status
        checkConnectivity(); 

        const intervalSeconds = parseInt(checkIntervalInput.value, 10);
        monitoringIntervalId = setInterval(checkConnectivity, intervalSeconds * 1000);

        // Attempt to load connection start time
        const storedStartTime = localStorage.getItem(LOG_PREFIX + 'connectionStartTime');
        if (storedStartTime && !connectionStartTime) {
            connectionStartTime = new Date(storedStartTime);
            connectTimeEl.textContent = connectionStartTime.toLocaleString();
            addEventLog("Resumed session, connection start time loaded from previous session.", "info");
        } else if (!connectionStartTime && navigator.onLine){
            // If no stored time and browser is online, set current time (will be refined by checkConnectivity)
            // connectionStartTime = new Date(); 
            // connectTimeEl.textContent = connectionStartTime.toLocaleString();
        }
        updateOverallStatus();
    }

    function stopMonitoring(reason = "Manual Stop") {
        if (!monitoringIntervalId) return; // Not running

        clearInterval(monitoringIntervalId);
        monitoringIntervalId = null;
        addEventLog(`Monitoring stopped. Reason: ${reason}`);
        startMonitoringBtn.disabled = false;
        stopMonitoringBtn.disabled = true;
        targetUrlInput.disabled = false;
        checkIntervalInput.disabled = false;
        
        updateConnectivityStatusUI('unknown', 'Not Running');
        if (isEffectivelyOnline) { // If it was online when stopped
            lastDisconnectionTime = new Date();
            disconnectTimeEl.textContent = lastDisconnectionTime.toLocaleString();
        }
        isEffectivelyOnline = false; // Ensure overall status reflects stopped state
        updateOverallStatus();
        generateReport(reason);
    }

    function handleOnlineStatusChange() {
        if (navigator.onLine) {
            handleOnline();
        } else {
            handleOffline();
        }
    }

    // --- Notifications & Reporting ---
    function requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        addEventLog("Desktop notification permission granted.", "success");
                    } else {
                        addEventLog("Desktop notification permission denied.", "info");
                    }
                });
            }
        }
    }

    function notifyUser(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: body, icon: 'network_icon.png' }); // You'd need an icon file
        } else {
            // Fallback or just log if no permission
            addEventLog(`DESKTOP NOTIFICATION (permission not granted or not supported): ${title} - ${body}`, 'info');
        }
        // You might want to also have an audible alert here for critical issues
        // var audio = new Audio('alert.mp3'); audio.play();
    }
    
    function generateReport(disconnectionReason = "Session Ended") {
        let report = `Network Monitoring Report\n`;
        report += `---------------------------\n`;
        report += `Monitoring Started: ${connectionStartTime ? connectionStartTime.toLocaleString() : 'N/A (or before page load)'}\n`;
        report += `Monitoring Ended/Disconnection: ${lastDisconnectionTime ? lastDisconnectionTime.toLocaleString() : getCurrentTimestamp()}\n`;
        report += `Target URL Checked: ${targetUrlInput.value}\n`;
        report += `Browser Status at End: ${navigator.onLine ? 'Online' : 'Offline'}\n`;
        report += `Last Successful Connectivity: ${lastSuccessfulCheckTime ? lastSuccessfulCheckTime.toLocaleString() : 'N/A'}\n`;
        report += `Reason for Report Generation: ${disconnectionReason}\n\n`;
        report += `Events During Session:\n`;
        
        const logEntries = Array.from(eventLogEl.children).map(p => p.textContent).reverse(); // chronological
        report += logEntries.join('\n');
        report += `\n---------------------------\nReport Generated: ${getCurrentTimestamp()}`;

        reportLogEl.value = report;
        return report;
    }

    function generateEmailReport() {
        const reportContent = reportLogEl.value || generateReport("Manual Report Generation");
        if (!reportContent) {
            alert("No report data to send.");
            return;
        }
        const subject = "Network Monitoring Report - " + getCurrentTimestamp();
        const body = encodeURIComponent(reportContent);
        // Replace with your email if you want it pre-filled, or leave empty
        const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
        window.open(mailtoLink, '_blank');
        addEventLog("Email report generated for user to send.", "info");
    }

    // --- Initial Setup ---
    requestNotificationPermission();
    window.addEventListener('online', handleOnlineStatusChange);
    window.addEventListener('offline', handleOnlineStatusChange);
    startMonitoringBtn.addEventListener('click', startMonitoring);
    stopMonitoringBtn.addEventListener('click', () => stopMonitoring("Manual Stop by User"));
    generateReportEmailBtn.addEventListener('click', generateEmailReport);

    // Auto-start if desired (and if user previously started)
    // For a true "start when I get to office", user must open this page.
    // You could use localStorage to "remember" to auto-start if the page is reloaded.
    // For now, we require manual start for clarity.
    addEventLog("Network Monitor Initialized. Click 'Start Monitoring'.", "info");
    handleOnlineStatusChange(); // Set initial browser status
    updateOverallStatus(); // Set initial overall status

    // Clear localStorage on fresh load if you don't want persistence across full browser closes
    // localStorage.removeItem(LOG_PREFIX + 'connectionStartTime'); 
});