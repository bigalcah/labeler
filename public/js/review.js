const setupCategoryForm = () => {
    const categoryForm = document.getElementById("new-category-form");
    if (!categoryForm) return;
    categoryForm.addEventListener("submit", async event => {
        event.preventDefault();
        const error = document.getElementById("category-error");
        error.classList.add("d-none");
        const token = categoryForm.querySelector("[name=csrf_token]")?.value;
        const response = await fetch(categoryForm.dataset.categoryAction, {
            method: "POST",
            headers: {"Content-Type": "application/json", "X-CSRF-Token": token || ""},
            body: JSON.stringify({name: document.getElementById("category-name").value}),
        });
        if (!response.ok) {
            error.classList.remove("d-none");
            return;
        }
        const category = await response.json();
        const option = new Option(category.raw_name, category.id, true, true);
        option.dataset.categoryUpdatedAt = category.updated_at || "";
        document.getElementById("category-id").add(option);
        const list = document.getElementById("category-management-list");
        if (list) {
            const item = document.createElement("li");
            item.className = "list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2";
            const label = document.createElement("span");
            label.dataset.categoryLabel = category.id;
            label.textContent = category.raw_name;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn btn-sm btn-outline-secondary";
            button.dataset.categoryRename = "";
            button.dataset.categoryId = category.id;
            button.dataset.categoryVersion = category.updated_at || "";
            button.dataset.categoryName = category.raw_name;
            button.dataset.bsToggle = "modal";
            button.dataset.bsTarget = "#rename-category-modal";
            button.append("Rename ");
            const hiddenName = document.createElement("span");
            hiddenName.className = "visually-hidden";
            hiddenName.textContent = category.raw_name;
            button.append(hiddenName);
            item.append(label, button);
            list.append(item);
        }
        window.bootstrap.Modal.getInstance(document.getElementById("new-category-modal")).hide();
        categoryForm.reset();
    });
};

const setupCategoryRename = () => {
    const renameForm = document.getElementById("rename-category-form");
    if (!renameForm) return;
    const categoryId = renameForm.elements.category_id;
    const expectedUpdatedAt = renameForm.elements.expected_updated_at;
    const categoryName = document.getElementById("rename-category-name");
    const error = document.getElementById("rename-category-error");
    const submitButton = renameForm.querySelector("button[type=submit]");
    let pending = false;
    const managementList = document.getElementById("category-management-list");
    managementList?.addEventListener("click", event => {
        const button = event.target.closest("[data-category-rename]");
        if (!button) return;
        categoryId.value = button.dataset.categoryId;
        expectedUpdatedAt.value = button.dataset.categoryVersion || "";
        categoryName.value = button.dataset.categoryName || "";
        error.classList.add("d-none");
    });
    renameForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (pending) return;
        pending = true;
        submitButton.disabled = true;
        error.classList.add("d-none");
        try {
            const token = renameForm.querySelector("[name=csrf_token]")?.value || "";
            const payload = {name: categoryName.value};
            if (expectedUpdatedAt.value) payload.expected_updated_at = expectedUpdatedAt.value;
            const response = await fetch(`${renameForm.dataset.categoryAction}/${encodeURIComponent(categoryId.value)}`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json", "X-CSRF-Token": token},
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                error.classList.remove("d-none");
                return;
            }
            const category = await response.json();
            const option = Array.from(document.querySelectorAll("#category-id option"))
                .find(candidate => candidate.value === category.id);
            if (option) {
                option.textContent = category.raw_name;
                option.dataset.categoryUpdatedAt = category.updated_at;
            }
            const button = Array.from(document.querySelectorAll("[data-category-rename]"))
                .find(candidate => candidate.dataset.categoryId === category.id);
            if (button) {
                button.dataset.categoryName = category.raw_name;
                button.dataset.categoryVersion = category.updated_at;
                button.textContent = "Rename ";
                const hiddenName = document.createElement("span");
                hiddenName.className = "visually-hidden";
                hiddenName.textContent = category.raw_name;
                button.append(hiddenName);
            }
            const label = document.querySelector(`[data-category-label="${CSS.escape(category.id)}"]`);
            if (label) label.textContent = category.raw_name;
            window.bootstrap.Modal.getInstance(document.getElementById("rename-category-modal")).hide();
            renameForm.reset();
        } finally {
            pending = false;
            submitButton.disabled = false;
        }
    });
};

const setupDiscardConfirmation = () => {
    document.querySelectorAll("[data-confirm-discard]").forEach(form => {
        form.addEventListener("submit", event => {
            if (!window.confirm(form.dataset.confirmDiscard)) event.preventDefault();
        });
    });
};

document.addEventListener("DOMContentLoaded", () => {
    setupCategoryForm();
    setupCategoryRename();
    setupDiscardConfirmation();
});
