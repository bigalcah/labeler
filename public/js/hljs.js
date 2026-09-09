window.hljs.configure({languages: ["json", "plaintext"]});
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("pre code").forEach(element => window.hljs.highlightElement(element));
    document.querySelectorAll("code.hljs").forEach(element => window.hljs.lineNumbersBlock(element, {startFrom: 1, singleLine: true}));
    document.querySelectorAll("span.hljs-string").forEach(element => {
        const content = element.textContent;
        const url = content.slice(1, -1);
        if (/(https?:\/\/)([^ ]+)/.test(url)) {
            const link = document.createElement("a");
            link.href = url;
            link.target = "_blank";
            if ("rel" in link) link.rel = "noopener noreferrer";
            link.textContent = content;
            element.replaceChildren(link);
        }
    });
});
