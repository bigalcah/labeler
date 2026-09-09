document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-local-section]").forEach(section => {
        const items = [...section.querySelectorAll("[data-local-item]")];
        if (items.length <= 10) return;
        items.slice(10).forEach(item => item.hidden = true);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-sm btn-outline-secondary mt-3";
        button.textContent = `Show ${items.length - 10} more locally`;
        button.addEventListener("click", () => {
            items.forEach(item => item.hidden = false);
            button.remove();
        });
        section.querySelector(".pr-event-list")?.append(button);
    });
});
