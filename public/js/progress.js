document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-progress-percentage]").forEach(progress => {
        progress.style.width = progress.dataset.progressPercentage;
    });
});
