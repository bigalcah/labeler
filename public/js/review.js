const categorySlotClass = slot => {
    const numericSlot = Number(slot);
    return `category-slot-${Number.isInteger(numericSlot) && numericSlot >= 0 && numericSlot < 12 ? numericSlot : 0}`;
};

const setDefinitionText = (element, definition) => {
    const text = typeof definition === "string" ? definition.trim() : "";
    element.textContent = text;
    element.hidden = text.length === 0;
};

const buildCategoryOption = category => {
    const item = document.createElement("li");
    item.className = `category-option ${categorySlotClass(category.color_slot)}`;
    item.dataset.categoryOption = category.id;

    const label = document.createElement("label");
    label.className = "category-option-label";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "category_id";
    radio.value = category.id;
    radio.className = "form-check-input category-radio";
    radio.dataset.categoryRadio = "";
    radio.dataset.categoryUpdatedAt = category.updated_at || "";

    const text = document.createElement("span");
    text.className = "category-option-text";
    const name = document.createElement("span");
    name.className = "category-name";
    name.dataset.categoryLabel = category.id;
    name.textContent = category.raw_name;
    const definition = document.createElement("span");
    definition.className = "category-definition";
    setDefinitionText(definition, category.definition);
    text.append(name, definition);

    const indicator = document.createElement("span");
    indicator.className = "category-selected-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const check = document.createElement("i");
    check.className = "bi bi-check-lg";
    indicator.append(check, document.createTextNode("Selected"));

    label.append(radio, text, indicator);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-secondary category-edit-button";
    button.dataset.categoryRename = "";
    button.dataset.categoryId = category.id;
    button.dataset.categoryVersion = category.updated_at || "";
    button.dataset.categoryName = category.raw_name;
    button.dataset.categoryDefinition = category.definition || "";
    button.dataset.bsToggle = "modal";
    button.dataset.bsTarget = "#rename-category-modal";
    button.append("Edit ");
    const hiddenName = document.createElement("span");
    hiddenName.className = "visually-hidden";
    hiddenName.textContent = category.raw_name;
    button.append(hiddenName);

    item.append(label, button);
    return item;
};

const updateCategoryOption = (item, category) => {
    if (!item) return;
    item.dataset.categoryOption = category.id;
    const radio = item.querySelector("[data-category-radio]");
    if (radio) {
        radio.value = category.id;
        radio.dataset.categoryUpdatedAt = category.updated_at || "";
    }
    Array.from(item.classList)
        .filter(className => className.startsWith("category-slot-"))
        .forEach(className => item.classList.remove(className));
    item.classList.add(categorySlotClass(category.color_slot));
    const name = item.querySelector(".category-name");
    if (name) name.textContent = category.raw_name;
    const text = item.querySelector(".category-option-text");
    let definition = item.querySelector(".category-definition");
    if (!definition && text) {
        definition = document.createElement("span");
        definition.className = "category-definition";
        text.append(definition);
    }
    if (definition) setDefinitionText(definition, category.definition);
    const button = item.querySelector("[data-category-rename]");
    if (button) {
        button.dataset.categoryName = category.raw_name;
        button.dataset.categoryVersion = category.updated_at || "";
        button.dataset.categoryDefinition = category.definition || "";
        const hiddenName = button.querySelector(".visually-hidden");
        if (hiddenName) hiddenName.textContent = category.raw_name;
    }
};

const refreshSelectedState = list => {
    if (!list) return;
    list.querySelectorAll("[data-category-option]").forEach(item => {
        const radio = item.querySelector("[data-category-radio]");
        item.classList.toggle("is-selected", Boolean(radio?.checked));
    });
};

const moveSelectedToTop = list => {
    if (!list) return;
    const selected = list.querySelector(".category-option.is-selected");
    if (!selected || list.firstElementChild === selected) return;
    list.prepend(selected);
};

const ensureRequiredSelection = list => {
    if (!list) return;
    const radios = [ ...list.querySelectorAll("[data-category-radio]") ];
    if (radios.length === 0) return;
    if (!radios.some(radio => radio.checked) && !radios.some(radio => radio.required)) {
        radios[0].required = true;
    }
};

const setupCategoryForm = () => {
    const categoryForm = document.getElementById("new-category-form");
    if (!categoryForm) return;
    const list = document.getElementById("category-list");
    const nameInput = document.getElementById("category-name");
    const definitionInput = document.getElementById("category-definition");
    const error = document.getElementById("category-error");
    categoryForm.addEventListener("submit", async event => {
        event.preventDefault();
        error.classList.add("d-none");
        const token = categoryForm.querySelector("[name=csrf_token]")?.value;
        const response = await fetch(categoryForm.dataset.categoryAction, {
            method: "POST",
            headers: {"Content-Type": "application/json", "X-CSRF-Token": token || ""},
            body: JSON.stringify({name: nameInput.value, definition: definitionInput.value}),
        });
        if (!response.ok) {
            error.classList.remove("d-none");
            return;
        }
        const category = await response.json();
        if (list) {
            list.querySelector("[data-category-empty]")?.remove();
            const item = buildCategoryOption(category);
            list.prepend(item);
            const radio = item.querySelector("[data-category-radio]");
            if (radio) radio.checked = true;
            ensureRequiredSelection(list);
            refreshSelectedState(list);
        }
        window.bootstrap?.Modal?.getInstance(document.getElementById("new-category-modal"))?.hide();
        categoryForm.reset();
    });
};

const setupCategoryRename = () => {
    const renameForm = document.getElementById("rename-category-form");
    if (!renameForm) return;
    const list = document.getElementById("category-list");
    const categoryId = renameForm.elements.category_id;
    const expectedUpdatedAt = renameForm.elements.expected_updated_at;
    const categoryName = document.getElementById("rename-category-name");
    const categoryDefinition = document.getElementById("rename-category-definition");
    const error = document.getElementById("rename-category-error");
    const submitButton = renameForm.querySelector("button[type=submit]");
    let pending = false;
    list?.addEventListener("click", event => {
        const button = event.target.closest("[data-category-rename]");
        if (!button) return;
        categoryId.value = button.dataset.categoryId;
        expectedUpdatedAt.value = button.dataset.categoryVersion || "";
        categoryName.value = button.dataset.categoryName || "";
        categoryDefinition.value = button.dataset.categoryDefinition || "";
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
            const payload = {name: categoryName.value, definition: categoryDefinition.value};
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
            const item = list?.querySelector(`[data-category-option="${CSS.escape(category.id)}"]`);
            updateCategoryOption(item, category);
            refreshSelectedState(list);
            window.bootstrap?.Modal?.getInstance(document.getElementById("rename-category-modal"))?.hide();
            renameForm.reset();
        } finally {
            pending = false;
            submitButton.disabled = false;
        }
    });
};

const setupCategorySelection = () => {
    const list = document.getElementById("category-list");
    if (!list) return;
    let pointerOrigin = null;
    list.addEventListener("pointerdown", event => {
        pointerOrigin = event.target.closest("[data-category-option]");
    });
    list.addEventListener("keydown", () => {
        pointerOrigin = null;
    });
    list.addEventListener("change", event => {
        if (!event.target.matches("[data-category-radio]")) return;
        refreshSelectedState(list);
        const origin = pointerOrigin;
        pointerOrigin = null;
        if (origin && origin === event.target.closest("[data-category-option]")) moveSelectedToTop(list);
    });
    list.addEventListener("focusout", event => {
        if (event.relatedTarget && list.contains(event.relatedTarget)) return;
        queueMicrotask(() => {
            if (!list.contains(document.activeElement)) moveSelectedToTop(list);
        });
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
    setupCategorySelection();
    setupDiscardConfirmation();
});
