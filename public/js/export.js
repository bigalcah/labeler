const panel = document.querySelector("[data-export-panel]");
const downloadButton = document.querySelector("#study-export-download");
const statusMessage = document.querySelector("[data-export-status]");
const errorMessage = document.querySelector("[data-export-error]");
const errorText = document.querySelector("[data-export-error-message]");
const loginLink = document.querySelector("[data-export-login]");
const downloadStartedCopy = "Download started. Check your browser’s downloads. The file may not be saved yet.";
const genericErrorCopy = "We couldn’t prepare the export. Please try again.";
const sessionExpiredCopy = "Your session has expired. Log in to continue.";
let requestInProgress = false;

const clearError = () => {
    errorMessage.classList.add("d-none");
    loginLink.classList.add("d-none");
    errorText.textContent = "";
};

const showError = (message, showLogin = false) => {
    statusMessage.hidden = true;
    statusMessage.textContent = "";
    errorText.textContent = message;
    loginLink.classList.toggle("d-none", !showLogin);
    errorMessage.classList.remove("d-none");
};

const setBusy = busy => {
    panel.setAttribute("aria-busy", String(busy));
    downloadButton.setAttribute("aria-disabled", String(busy));
    downloadButton.setAttribute("aria-busy", String(busy));
    downloadButton.classList.toggle("disabled", busy);
    if (busy) {
        statusMessage.hidden = false;
        statusMessage.textContent = "Preparing your download…";
    }
};

const downloadCsv = async () => {
    if (requestInProgress) return;

    requestInProgress = true;
    let downloadStarted = false;
    clearError();
    setBusy(true);

    try {
        const response = await fetch(downloadButton.dataset.downloadUrl, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {"X-CSRF-Token": downloadButton.dataset.csrfToken},
        });

        if (response.status === 401) {
            showError(sessionExpiredCopy, true);
            return;
        }
        if (response.status === 403) {
            window.location.replace("/export");
            return;
        }
        if (!response.ok || !/^text\/csv(?:\s*;|$)/i.test(response.headers.get("Content-Type") || "")) {
            showError(genericErrorCopy);
            return;
        }

        const csvBlob = await response.blob();
        const objectUrl = URL.createObjectURL(csvBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = "pr-classifications.csv";
        downloadLink.hidden = true;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        downloadStarted = true;
    } catch (_error) {
        showError(genericErrorCopy);
    } finally {
        requestInProgress = false;
        setBusy(false);
        if (downloadStarted) statusMessage.textContent = downloadStartedCopy;
        if (!errorMessage.classList.contains("d-none")) statusMessage.hidden = true;
    }
};

downloadButton.addEventListener("click", downloadCsv);
