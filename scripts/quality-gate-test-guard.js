const isPassingTestSummary = summary => {
    const counts = summary?.counts;
    if (!counts || summary.success !== true) return false;

    const countValues = [counts.tests, counts.passed, counts.failed, counts.skipped, counts.cancelled, counts.todo];
    return countValues.every(value => Number.isInteger(value) && value >= 0)
        && counts.tests > 0
        && counts.passed === counts.tests
        && counts.failed === 0
        && counts.skipped === 0
        && counts.cancelled === 0
        && counts.todo === 0;
};

export {isPassingTestSummary};
