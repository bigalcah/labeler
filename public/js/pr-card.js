document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-local-section]").forEach(section => {
        const items = [...section.querySelectorAll("[data-local-item]")];
        const list = section.querySelector(".pr-event-list");
        const pageSize = Number.parseInt(list?.dataset.pageSize ?? "", 10);
        if (!list || !Number.isInteger(pageSize) || pageSize < 1 || items.length <= pageSize) return;
        items.forEach(item => item.hidden = true);
        items.slice(0, pageSize).forEach(item => item.hidden = false);
        const remaining = () => items.filter(item => item.hidden).length;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-sm btn-outline-secondary mt-3";
        button.textContent = `Show ${Math.min(pageSize, remaining())} more`;
        button.addEventListener("click", () => {
            const batch = Math.min(pageSize, remaining());
            let revealed = 0;
            for (const item of items) {
                if (revealed >= batch) break;
                if (item.hidden) {
                    item.hidden = false;
                    revealed += 1;
                }
            }
            if (remaining() === 0) {
                button.remove();
                section.querySelector("summary")?.focus();
            } else {
                button.textContent = `Show ${Math.min(pageSize, remaining())} more`;
            }
        });
        list.append(button);
    });
});
