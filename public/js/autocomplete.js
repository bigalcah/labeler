import Autocomplete from "https://cdn.jsdelivr.net/npm/bootstrap5-autocomplete@1.1.38/autocomplete.min.js";

const toggleSpinner = instance => {
    const input = instance.getInput();
    const spinner = document.getElementById(`${input.id}-spinner`);
    spinner.classList.toggle("d-none");
};

for (const element of document.querySelectorAll(".autocomplete")) {
    new Autocomplete(element, {
        onBeforeFetch: toggleSpinner,
        onAfterFetch: toggleSpinner,
        notFoundMessage: "No suggestions available...",
        highlightClass: "text-decoration-underline bg-transparent text-current p-0",
        suggestionsThreshold: 2,
        debounceTime: 300,
        liveServer: true,
        highlightTyped: true,
        fullWidth: true,
    });
}
