export default async function* qualityGateReporter(source) {
    let summary = null;
    for await (const event of source) {
        if (event.type === "test:summary" && event.data.file === undefined) {
            summary = {success: event.data.success, counts: event.data.counts};
        }
    }
    if (summary) yield `${JSON.stringify(summary)}\n`;
}
