import {marked} from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS = {
    allowedTags: [
        "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
    ],
    allowedAttributes: {
        a: [ "href", "title" ],
    },
    allowedSchemes: [ "http", "https", "mailto" ],
    allowProtocolRelative: false,
};

const renderSafeMarkdown = value => {
    if (value === null || value === undefined || value === "") return "";

    const rendered = marked.parse(String(value), {
        gfm: true,
        breaks: true,
    });
    return sanitizeHtml(rendered, SANITIZE_OPTIONS);
};

export {renderSafeMarkdown};
